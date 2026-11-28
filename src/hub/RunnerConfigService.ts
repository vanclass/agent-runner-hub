import { msg, errorText, HubError, type HubText } from './i18n';
import type { ConnectedRunMode } from './RunnerRecovery';
import { copy, same, record, isInspection, isTestSelection, isSessionProvider, sameInstallation, isPlan, isApply, validatePage, uniqueOptions, validDesired,
  type ConfigAccount, type ConfigCapability, type ConfigCatalog, type ConfigDesired, type ConfigIdentity,
  type ConfigInspect, type ConfigPlan, type ConfigApply, type ConfigSettings, type ConfigRequest, type FeatureSnapshot,
  type FeatureAdmission, type FeatureResult, type BoundTestSelection, type SessionProvider,
  isProviderCatalog, type ProviderCatalog, type ConfigAction } from './runnerConfigContract';

export interface ConfigTransport {
  identity(): ConfigIdentity | undefined;
  available(): boolean;
  backgroundAvailable(): boolean;
  submit(session: string, request: ConfigRequest): Promise<FeatureAdmission>;
}
export type ConfigActivity = 'idle' | 'inspecting' | 'catalog' | 'planning' | 'applying' | 'verifying' | 'closed';
export type ConfigApplication = { receipt: FeatureResult; result?: ConfigApply;
  plan: ConfigPlan; before: ConfigSettings;
  verification: 'pending' | 'verified' | 'unavailable' | 'unknown'; inspection?: ConfigInspect };
const terminal = (result: FeatureResult) => ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(result.state);
const optionRefreshMs = 30_000;
type ConfigWait = { id?: number; identity: ConfigIdentity; request: ConfigRequest;
  finish: (result: FeatureResult) => void; timer: ReturnType<typeof setTimeout> };

/** One Runner instance owns this service; drafts and receipts never enter preferences. */
export class RunnerConfigService {
  capability?: ConfigCapability;
  inspectionUnsupported = false;
  activity: ConfigActivity = 'idle';
  progress?: FeatureResult;
  actual?: ConfigInspect;
  catalog?: ConfigCatalog;
  private effectiveCatalog?: ConfigCatalog;
  private destinationCatalog?: ConfigCatalog;
  private observedAccount?: string;
  private observedSettings?: string;
  private optionsEpoch = 0;
  private optionsDue = 0;
  private providersDue = 0;
  private optionsRead?: { account?: ConfigAccount; claimed?: boolean; promise: Promise<ConfigCatalog | undefined> };
  // Keep read progress separate while native continues to own admission and FIFO.
  private backgroundWait?: ConfigWait;
  optionsError: HubText = '';
  providersError: HubText = '';
  get currentCatalog() {
    const current = this.effectiveCatalog;
    return this.applicableOptions(current) ? current : undefined;
  }
  private applicableOptions(catalog?: ConfigCatalog) {
    return !!catalog && catalog.inspection.effective.account === this.observedAccount
      && catalog.inspection.effective.agent_id === this.observedAgentId && same(catalog.identity, this.identity);
  }
  optionsFor(account?: ConfigAccount) {
    if (!account || same(account, this.currentCatalog?.inspection.model_options_account)) return this.currentCatalog;
    return this.applicableOptions(this.destinationCatalog)
      && same(account, this.destinationCatalog?.inspection.model_options_account) ? this.destinationCatalog : undefined;
  }
  providers?: ProviderCatalog;
  providerOutcomeUnknown = false;
  draft: ConfigDesired = {};
  plan?: ConfigPlan;
  error: HubText = '';
  readonly applications: ConfigApplication[] = [];
  private confirmations = new WeakMap<ConfigApplication, (application: ConfigApplication) => void>();
  private presentationOffset = 0;
  private presentationReceiptOffset = 0;
  private previousProgress: FeatureResult | undefined | null = null;
  get presentedApplications() { return this.applications.slice(this.presentationOffset); }
  get presentedError() { return this.progress === this.previousProgress ? '' : this.error; }
  get presentedProgress() { return this.progress === this.previousProgress ? undefined : this.progress; }
  get presentedRequests() { return [...this.receipts.values()].slice(this.presentationReceiptOffset); }
  beginPresentation() {
    this.presentationOffset = this.applications.length;
    this.presentationReceiptOffset = this.receipts.size;
    this.previousProgress = this.progress;
  }
  private identity?: ConfigIdentity;
  private agentId?: string;
  get observedAgentId() { return this.agentId; }
  private effectiveRevision = 0;
  get providerRevision() { return this.effectiveRevision; }
  private draftVersion = 0;
  private planned?: { identity: ConfigIdentity; draftVersion: number };
  private closed = false;
  private restoringMode = false;
  private snapshot?: FeatureSnapshot;
  private receipts = new Map<number, FeatureResult>();
  private waiting?: ConfigWait;
  constructor(private readonly transport: ConfigTransport, private readonly changed: () => void) {}
  get busy() { return !['idle', 'closed'].includes(this.activity); }
  get modeRestorationActive() { return this.restoringMode; }
  get latestApplication() { return this.applications.at(-1); }
  get uncertain() { return this.providerOutcomeUnknown
    || this.applications.some(a => a.verification === 'unknown' || a.result?.outcome_unknown); }
  supports(action: ConfigAction) {
    return !this.closed && this.capability?.version === 1 && this.capability.options_revision === true
      && this.capability.operations.includes(`session_config.${action}`) === true;
  }
  get inspectionApplicable() {
    return this.observedAgentId !== 'none' && this.supports('inspect');
  }
  get canApply() {
    return this.supports('apply') && !this.busy && !this.uncertain && this.plan?.plan_status === 'ready'
      && !!this.planned && this.planned.draftVersion === this.draftVersion
      && same(this.planned.identity, this.transport.identity()) && this.transport.available();
  }
  getReceipt(id: number) { return this.receipts.get(id); }
  observe(session: string, state: string, snapshot?: FeatureSnapshot, agentId?: string, account?: string, settings?: string) {
    if (this.closed) return;
    const previousCapability = this.capability, previousAgentId = this.observedAgentId;
    this.agentId = state === 'ready' ? agentId : undefined;
    if (previousAgentId !== this.observedAgentId) {
      this.effectiveRevision++;
      this.draftVersion++;
      // A new Provider makes any old background read unusable, even if its
      // completed receipt was retired before the frontend sampled it.
      const background = this.backgroundWait;
      if (background) background.finish(this.unknown(background.request, background.id, true));
      this.actual = undefined;
      this.catalog = undefined;
      this.effectiveCatalog = undefined;
      this.destinationCatalog = undefined;
      this.providers = undefined;
      this.providersDue = 0;
      this.providersError = '';
      this.plan = undefined;
      this.planned = undefined;
      const { account, model, service_tier, ...independent } = this.draft;
      this.draft = independent;
    }
    if (previousAgentId !== this.observedAgentId || this.observedSettings !== settings || this.observedAccount !== account) {
      this.optionsEpoch++;
      this.optionsDue = 0;
      this.optionsError = '';
      if (this.observedAccount !== account) {
        this.destinationCatalog = undefined;
        if (this.effectiveCatalog?.inspection.effective.account !== account) this.effectiveCatalog = undefined;
      }
      this.observedSettings = settings;
      this.observedAccount = account;
    }
    const previousUnsupported = this.inspectionUnsupported;
    let applicationChanged = false;
    const identity = state === 'ready' && snapshot && snapshot.generation > 0
      ? { session, generation: snapshot.generation } : undefined;
    if (this.identity && identity && !same(identity, this.identity)) { this.close(); return; }
    if (identity) this.identity = identity;
    this.snapshot = snapshot;
    const cap = snapshot?.sessionConfig;
    this.capability = state === 'ready' && cap?.version === 1 && cap.options_revision === true
      && Number.isSafeInteger(cap.options_page_size) && cap.options_page_size > 0 && cap.options_page_size <= 32
      && Array.isArray(cap.operations) && cap.operations.includes('session_config.inspect') ? cap : undefined;
    // Native ready snapshots publish capabilities from a completed authenticated observation.
    this.inspectionUnsupported = !!identity && !this.supports('inspect');
    if (!this.capability) {
      if (previousCapability) this.effectiveRevision++;
      this.actual = undefined; this.catalog = undefined; this.effectiveCatalog = undefined;
      this.destinationCatalog = undefined; this.providers = undefined;
      this.optionsDue = this.providersDue = 0;
      this.optionsError = this.providersError = '';
      if (previousCapability) this.optionsEpoch++;
      this.plan = undefined; this.planned = undefined;
    }
    for (const receipt of snapshot?.results ?? []) {
      if (receipt.feature !== 'session_config' || (receipt.id !== this.waiting?.id && !this.receipts.has(receipt.id))) continue;
      if (terminal(receipt)) this.receipts.set(receipt.id, copy(receipt));
      const application = this.applications.find(a => a.receipt.id === receipt.id && a.receipt.phase !== 'completed');
      if (application && receipt.phase === 'completed' && isApply(receipt.reply, application.plan, application.before)) {
        application.receipt = copy(receipt);
        application.result = copy(receipt.reply);
        application.verification = receipt.reply.outcome_unknown ? 'unknown' : 'unavailable';
        this.publishConfirmation(application);
        applicationChanged = true;
      }
    }
    this.deliver();
    if (this.backgroundWait) this.deliver(this.backgroundWait);
    if (state === 'disconnected') this.close();
    else if (applicationChanged || this.waiting || previousUnsupported !== this.inspectionUnsupported
      || previousAgentId !== this.observedAgentId || !same(previousCapability, this.capability)) this.changed();
  }
  private deliver(wait = this.waiting) {
    if (!wait || wait.id === undefined || !same(wait.identity, this.identity)) return;
    const result = this.snapshot?.results.find(r => r.id === wait.id && r.feature === 'session_config'
      && r.operation === wait.request.operation);
    if (!result) return;
    if (wait === this.waiting) this.progress = copy(result);
    if (terminal(result)) wait.finish(copy(result));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.effectiveRevision++;
    this.agentId = undefined;
    this.inspectionUnsupported = false;
    this.capability = undefined;
    this.actual = undefined;
    this.catalog = undefined;
    this.effectiveCatalog = undefined;
    this.destinationCatalog = undefined;
    this.providers = undefined;
    this.plan = undefined;
    this.planned = undefined;
    const wait = this.waiting;
    if (wait) wait.finish(this.unknown(wait.request, wait.id));
    const background = this.backgroundWait;
    if (background) background.finish(this.unknown(background.request, background.id, true));
    this.activity = 'closed';
    this.changed();
  }
  private unknown(request: ConfigRequest, id = 0, background = false): FeatureResult {
    return { id, feature: 'session_config', operation: request.operation, state: 'outcome-unknown',
      admission: !background && this.progress?.id === id ? this.progress.admission : 'unconfirmed', code: 'CONFIG_RECEIPT_UNAVAILABLE' };
  }
  private assertIdentity(identity: ConfigIdentity) {
    if (this.closed || !same(identity, this.transport.identity()) || !same(identity, this.identity))
      throw new HubError(msg('config.identityChanged'));
  }
  private request(request: ConfigRequest, background = false): Promise<FeatureResult> {
    const identity = this.transport.identity();
    const action = request.operation.split('.')[1] as ConfigAction;
    const slot = background ? 'backgroundWait' : 'waiting';
    if (action === 'inspect' && !this.inspectionApplicable) throw new HubError(msg('config.unsupported'));
    if (!identity || !this.supports(action) || this[slot]) throw new HubError(msg('config.unsupported'));
    this.assertIdentity(identity);
    if (!background) {
      this.progress = { id: 0, feature: 'session_config', operation: request.operation,
        state: 'sending', admission: 'unconfirmed' };
      this.changed();
    }
    return new Promise(resolve => {
      const finish = (result: FeatureResult) => {
        if (this[slot]?.finish !== finish) return;
        clearTimeout(this[slot].timer);
        this[slot] = undefined;
        if (!background) {
          this.progress = result;
          if (result.id) this.receipts.set(result.id, copy(result));
          this.changed();
        }
        resolve(result);
      };
      // Native owns the FIFO-head deadline; this is a bounded delivery grace.
      const timer = setTimeout(() => finish(this.unknown(request, this[slot]?.id, background)),
        (action === 'apply' || action === 'select_provider' ? 1830 : action === 'plan' ? 630 : 450) * 1000);
      this[slot] = { identity: copy(identity), request, finish, timer };
      void this.transport.submit(identity.session, request).then(admission => {
        if (this[slot]?.finish !== finish) return;
        if (admission.state !== 'submitted') {
          finish({ ...this.unknown(request, 0, background), state: admission.state,
            admission: admission.state === 'not-sent' ? 'not-sent' : 'unconfirmed', code: admission.detail });
          return;
        }
        if (admission.generation !== identity.generation) { finish(this.unknown(request, admission.id, background)); return; }
        this[slot].id = admission.id;
        this.deliver(this[slot]);
      }, () => finish(this.unknown(request, this[slot]?.id, background)));
    });
  }
  private completion(receipt: FeatureResult) {
    if (receipt.admission === 'rejected') throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_REQUEST_REJECTED' }));
    if (receipt.phase !== 'completed' || !['accepted', 'rejected', 'failure', 'outcome-unknown'].includes(receipt.state))
      throw new HubError(msg(receipt.state === 'not-sent' ? 'config.notSent' : 'config.receiptUnknown'));
    return receipt.reply;
  }
  async selectProvider(agentId: string) {
    const catalog = this.providers;
    if (this.busy || this.closed || this.uncertain || this.providerOutcomeUnknown || !catalog
      || catalog.current_agent_id !== this.observedAgentId || !this.transport.available()
      || !catalog.providers.some(p => p.agent_id === agentId && p.available)) return;
    this.error = '';
    this.activity = 'applying'; this.changed();
    try {
      const receipt = await this.request({ operation: 'session_config.select_provider', api_version: 1,
        expected_agent_id: catalog.current_agent_id, agent_id: agentId });
      const reply = receipt.reply;
      if (receipt.phase === 'completed' && record(reply) && reply.api_version === 1) {
        if (receipt.state === 'accepted' && reply.current_agent_id === agentId && typeof reply.changed === 'boolean') {
          if (reply.changed) {
            this.providers = undefined;
            this.effectiveCatalog = this.destinationCatalog = undefined;
            this.optionsEpoch++;
          }
          this.providersDue = 0;
          return { confirmed: true, changed: reply.changed };
        }
        this.providersDue = 0;
        if (receipt.state === 'rejected' && !reply.outcome_unknown)
          return { confirmed: false, code: receipt.code, reason: typeof reply.reason === 'string' ? reply.reason : undefined,
            confirmations: reply.interaction_owner === 'runner_terminal' && Array.isArray(reply.required_confirmations)
              ? reply.required_confirmations.filter((v): v is string => typeof v === 'string') : [] };
      }
      this.providerOutcomeUnknown = receipt.state !== 'not-sent' && receipt.admission !== 'rejected';
      if (this.providerOutcomeUnknown) {
        this.effectiveCatalog = this.destinationCatalog = undefined;
        this.optionsEpoch++;
      }
      this.providersDue = 0;
      this.error = msg(this.providerOutcomeUnknown ? 'config.receiptUnknown' : 'config.notSent');
    } catch (reason) { this.error = errorText(reason); }
    finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  private async refreshProviders() {
    const revision = this.providerRevision;
    this.providersDue = performance.now() + optionRefreshMs;
    try {
      const receipt = await this.request({ operation: 'session_config.providers', api_version: 1 }, true);
      if (this.closed || revision !== this.providerRevision) {
        this.providersDue = 0;
        return;
      }
      const reply = this.completion(receipt);
      if (receipt.state !== 'accepted')
        throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_PROVIDER_INSPECTION_FAILED' }));
      if (!isProviderCatalog(reply)
        || reply.current_agent_id !== this.observedAgentId) throw new HubError(msg('config.identityChanged'));
      this.providers = copy(reply);
      this.providerOutcomeUnknown = false;
      this.providersError = '';
    } catch (reason) {
      this.providersError = errorText(reason);
    }
    finally { this.changed(); }
  }
  private async page(identity: ConfigIdentity, account?: ConfigAccount, offset = 0, guard?: string, background = false) {
    this.assertIdentity(identity);
    const revision = this.providerRevision;
    const receipt = await this.request({ operation: 'session_config.inspect', api_version: 1, offset,
      ...(account ? { account: copy(account) } : {}), ...(guard ? { options_revision: guard } : {}) }, background);
    this.assertIdentity(identity);
    if (revision !== this.providerRevision) throw new HubError(msg('config.identityChanged'));
    const reply = this.completion(receipt);
    if (receipt.state !== 'accepted' || !isInspection(reply))
      throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_INSPECTION_FAILED' }));
    if (this.observedAgentId !== undefined && reply.effective.agent_id !== this.observedAgentId)
      throw new HubError(msg('config.identityChanged'));
    return copy(reply);
  }
  /** Read-only admission evidence for explicit native acceptance, never a preference. */
  async selectTestAccount(provider: SessionProvider): Promise<BoundTestSelection | undefined> {
    if (this.busy || this.closed || this.uncertain) return;
    const identity = this.transport.identity(), root = this.snapshot?.runnerRoot;
    this.activity = 'inspecting'; this.error = ''; this.changed();
    try {
      if (!identity || !root || !this.transport.available() || !isSessionProvider(provider)
        || this.capability?.test_account_selection !== true || !this.capability.test_account_providers?.includes(provider))
        throw new Error('TEST_ACCOUNT_SELECTION_UNSUPPORTED');
      this.assertIdentity(identity);
      const receipt = await this.request({ operation: 'session_config.inspect', api_version: 1, execution_context: 'test', agent_id: provider });
      this.assertIdentity(identity);
      const reply = this.completion(receipt);
      if (receipt.state !== 'accepted' || !isTestSelection(reply)) {
        const details = record(reply) ? [reply.actual_result, reply.recommended_next_action]
          .filter((s): s is string => typeof s === 'string' && !!s) : [];
        throw new Error([receipt.code ?? 'TEST_ACCOUNT_EVIDENCE_UNVERIFIED', ...details].join('. '));
      }
      if (reply.account.agent_id !== provider) throw new Error('TEST_ACCOUNT_PROVIDER_MISMATCH');
      if (this.snapshot?.runnerRoot !== root || !sameInstallation(reply.runner_root, root))
        throw new Error('TEST_ACCOUNT_INSTALLATION_MISMATCH');
      const home = reply.codex_home ?? reply.claude_config_dir;
      const expectedHome = `${reply.runner_root.replace(/\/$/, '')}/local/profiles/${provider}/accounts/${reply.account.profile_name}`;
      if (!sameInstallation(home, expectedHome)) throw new Error('TEST_ACCOUNT_PROFILE_MISMATCH');
      return { identity: copy(identity), selection: copy(reply) };
    } catch (reason) {
      this.error = msg('config.testAccountFailed', { diagnostic: String(reason instanceof Error ? reason.message : reason) });
      return undefined;
    } finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  async inspect(account?: ConfigAccount, reuseOptions = false) {
    this.previousProgress = null;
    if (this.busy || this.closed) return;
    this.activity = account ? 'catalog' : 'inspecting';
    this.error = '';
    this.catalog = undefined;
    this.plan = undefined;
    this.planned = undefined;
    this.changed();
    const version = this.draftVersion;
    const providerRevision = this.providerRevision;
    try {
      const identity = this.transport.identity();
      if (!identity) throw new HubError(msg('config.notReady'));
      const observedAgentId = this.observedAgentId;
      const selected = account?.agent_id === observedAgentId ? account : undefined;
      const retained = reuseOptions ? this.optionsFor(selected) : undefined;
      let catalog = retained;
      const read = this.optionsRead;
      if (!catalog && read && (same(read.account, selected)
        || !read.account && selected?.profile_name === this.observedAccount)) {
        read.claimed = true;
        catalog = await read.promise;
        if (selected && !same(catalog?.inspection.model_options_account, selected)) catalog = undefined;
        if (!catalog && !read.account && this.optionsError) throw new HubError(this.optionsError);
      }
      catalog ??= await this.collect(identity, selected);
      if (!catalog) throw new HubError(msg('config.incomplete'));
      this.assertIdentity(identity);
      if (version !== this.draftVersion) throw new HubError(msg('config.draftChanged'));
      if (providerRevision !== this.providerRevision) throw new HubError(msg('config.identityChanged'));
      if (!retained) {
        this.actual = catalog.inspection;
        this.reconcileInspection(catalog.inspection);
      }
      this.catalog = catalog;
      if (!retained) this.storeOptions(catalog);
      return { catalog };
    } catch (reason) {
      this.error = errorText(reason);
      return { error: this.error };
    }
    finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  private async collect(identity: ConfigIdentity, selected?: ConfigAccount, background?: () => boolean) {
      const cap = this.capability;
      if (!cap || !this.inspectionApplicable) throw new HubError(msg('config.unsupported'));
      const observedAgentId = this.observedAgentId;
      const first = await this.page(identity, selected, 0, undefined, !!background);
      if (!same(first.model_options_account, selected ?? first.current.account)) throw new HubError(msg('config.identityChanged'));
      const options = copy(first.options);
      let page = first, offset = 0;
      for (;;) {
        if (!validatePage(page, first, offset, cap.options_page_size)) throw new HubError(msg('config.incomplete'));
        if (page.options_page.next_offset === null) break;
        if (background && !background()) return undefined;
        offset = page.options_page.next_offset;
        page = await this.page(identity, selected, offset, first.options_revision, !!background);
        for (const key of ['targets', 'accounts', 'models'] as const) {
          // Concatenate only after validating this page; publish only at terminal null.
          if (!validatePage(page, first, offset, cap.options_page_size)) throw new HubError(msg('config.incomplete'));
          (options[key] as unknown[]).push(...page.options[key]);
        }
        if (!uniqueOptions(options)) throw new HubError(msg('config.identityChanged'));
      }
      if (!uniqueOptions(options) || (selected && !options.accounts.some(a => same(a, selected))))
        throw new HubError(msg('config.identityChanged'));
      const applicable = isSessionProvider(observedAgentId) && first.effective.agent_id === observedAgentId;
      options.accounts = applicable ? options.accounts.filter(a => a.agent_id === observedAgentId) : [];
      if (!applicable || first.model_options_account.agent_id !== observedAgentId) options.models = [];
      return { identity: copy(identity), account: copy(selected), inspection: first, options };
  }
  private reconcileInspection(first: ConfigInspect) {
    for (const application of this.applications) {
      if (application.result && application.verification === 'unavailable'
        && application.before.account.agent_id === first.effective.agent_id) {
        application.verification = 'verified'; application.inspection = copy(first);
      }
    }
  }
  private storeOptions(catalog: ConfigCatalog) {
    const { current, model_options_account } = catalog.inspection;
    if (same(current.account, model_options_account)) {
      this.optionsDue = performance.now() + optionRefreshMs;
      if (catalog.inspection.model_catalog_status === 'unavailable'
        && this.currentCatalog?.inspection.model_catalog_status === 'available') {
        this.optionsError = msg('config.incomplete');
        return;
      }
      this.effectiveCatalog = catalog;
      this.optionsError = '';
    } else this.destinationCatalog = catalog;
  }
  get optionsRefreshing() { return !!this.optionsRead && !this.optionsRead.account; }
  get providersRefreshing() { return this.backgroundWait?.request.operation === 'session_config.providers'; }
  private get canRefreshOptions() {
    return !this.closed && !this.busy && !this.optionsRead && !this.backgroundWait && this.transport.backgroundAvailable();
  }
  refreshOptions() {
    if (!this.canRefreshOptions) return;
    const now = performance.now();
    if (this.supports('providers') && now >= this.providersDue
      && (this.providerOutcomeUnknown || !this.providers && !this.providersDue)) {
      void this.refreshProviders();
    } else if (this.inspectionApplicable && !this.providerOutcomeUnknown && now >= this.optionsDue) {
      void this.startOptionsRead();
    } else if (this.supports('providers') && now >= this.providersDue) {
      void this.refreshProviders();
    }
  }
  lookupOptions(account?: ConfigAccount) {
    if (!this.inspectionApplicable) return;
    if (account && account.agent_id !== this.observedAgentId) return;
    if (this.optionsRead && same(account, this.optionsRead.account)) return this.optionsRead.promise;
    if (this.canRefreshOptions && !this.providerOutcomeUnknown
      && (account || performance.now() >= this.optionsDue)) return this.startOptionsRead(account);
  }
  private startOptionsRead(account?: ConfigAccount) {
    const identity = this.transport.identity();
    if (!identity) return;
    const epoch = this.optionsEpoch;
    if (!account) this.optionsDue = performance.now() + optionRefreshMs;
    const promise = this.collect(identity, account, () => epoch === this.optionsEpoch
      && (this.optionsRead?.claimed === true || !this.busy && this.transport.backgroundAvailable()))
      .then(catalog => {
        if (this.closed || epoch !== this.optionsEpoch || this.providerOutcomeUnknown) return;
        if (!catalog || this.busy && !this.optionsRead?.claimed) {
          if (!account) this.optionsDue = 0;
          return;
        }
        if (catalog.inspection.effective.account !== this.observedAccount) {
          if (!account) this.optionsError = msg('config.identityChanged');
          return;
        }
        this.storeOptions(catalog);
        if (!account && !this.plan && this.transport.backgroundAvailable()) this.actual = catalog.inspection;
        return catalog;
      }).catch(reason => {
        if (!this.closed && epoch === this.optionsEpoch && !account) this.optionsError = errorText(reason);
        return undefined;
      }).finally(() => { this.optionsRead = undefined; this.changed(); });
    this.optionsRead = { account, promise };
    return promise;
  }
  setDraft(change: ConfigDesired) {
    if (this.closed) return;
    this.draft = { ...this.draft, ...copy(change) };
    this.draftVersion++;
    this.plan = undefined;
    this.planned = undefined;
    this.error = '';
    this.changed();
  }
  async selectAccount(account: ConfigAccount) {
    if (this.busy) return;
    this.setDraft({ account });
    await this.inspect(account);
  }
  resetDraft() {
    if (this.busy || this.closed) return;
    this.draft = {};
    this.draftVersion++;
    this.plan = undefined;
    this.planned = undefined;
    this.catalog = undefined;
    this.changed();
  }
  async restoreMode(mode: ConnectedRunMode) {
    if (this.busy || this.closed || this.uncertain || this.restoringMode) return false;
    this.restoringMode = true;
    try {
      await this.inspect();
      if (!this.catalog || !this.actual || this.closed) return false;
      if (this.actual.current.run_mode === mode) return true;
      this.setDraft({ run_mode: mode });
      await this.createPlan();
      if (!this.canApply) return false;
      await this.apply();
      const receipt = this.latestApplication;
      return receipt?.verification === 'verified' && receipt.result?.apply_status === 'applied'
        && receipt.inspection?.current.run_mode === mode;
    } finally {
      this.resetDraft();
      this.restoringMode = false;
    }
  }
  async createPlan() {
    this.previousProgress = null;
    if (this.busy || this.closed) return;
    this.error = '';
    this.plan = undefined;
    this.planned = undefined;
    const identity = this.transport.identity(), version = this.draftVersion, desired = copy(this.draft);
    const providerRevision = this.providerRevision;
    if (!identity || !this.catalog || !same(identity, this.catalog.identity)
      || !validDesired(desired, this.catalog.inspection.current, this.catalog) || !this.transport.available()) {
      this.error = msg('config.invalidCombination'); this.changed(); return;
    }
    this.activity = 'planning'; this.changed();
    try {
      const receipt = await this.request({ operation: 'session_config.plan', api_version: 1, desired });
      this.assertIdentity(identity);
      const reply = this.completion(receipt);
      if (!isPlan(reply) || !same(reply.desired, desired) || (reply.plan_status === 'ready' && receipt.state !== 'accepted'))
        throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_PLAN_MISMATCH' }));
      if (version !== this.draftVersion || providerRevision !== this.providerRevision)
        throw new HubError(msg('config.draftChanged'));
      this.plan = copy(reply);
      this.planned = { identity: copy(identity), draftVersion: version };
    } catch (reason) { this.error = errorText(reason); }
    finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  private publishConfirmation(application: ConfigApplication) {
    if (!application.result) return;
    const notify = this.confirmations.get(application);
    this.confirmations.delete(application);
    notify?.(application);
  }
  async apply(onConfirmed?: (application: ConfigApplication) => void) {
    if (!this.canApply || !this.plan || !this.planned) return;
    const plan = copy(this.plan), identity = copy(this.planned.identity), version = this.draftVersion;
    const providerRevision = this.providerRevision;
    this.activity = 'verifying'; this.error = ''; this.changed();
    try {
      const retained = [this.actual, this.currentCatalog?.inspection, this.catalog?.inspection]
        .find(inspection => inspection?.revision === plan.revision);
      const latest = retained ?? await this.page(identity);
      if (providerRevision !== this.providerRevision || version !== this.draftVersion || latest.revision !== plan.revision
        || latest.effective.agent_id !== this.catalog?.inspection.effective.agent_id) throw new HubError(msg('config.stalePlan'));
      if (!retained) this.actual = latest;
      this.activity = 'applying'; this.changed();
      const receipt = await this.request({ operation: 'session_config.apply', api_version: 1,
        desired: copy(plan.desired), revision: plan.revision, plan_id: plan.plan_id! });
      const reply = receipt.phase === 'completed' ? receipt.reply : undefined;
      const valid = isApply(reply, plan, latest.current);
      const ownerRejected = receipt.state === 'rejected' && valid && reply.apply_status === 'rejected' && reply.results.length === 0;
      const noEffect = receipt.state === 'not-sent' || receipt.admission === 'rejected' || ownerRejected;
      const application: ConfigApplication = { receipt: copy(receipt), result: valid ? copy(reply) : undefined,
        plan: copy(plan), before: copy(latest.current),
        verification: noEffect ? 'pending' : !valid || receipt.state === 'outcome-unknown' || (valid && reply.outcome_unknown) ? 'unknown' : 'pending' };
      // This record is independent of the following read; confirmed receipts survive it.
      this.applications.push(application);
      if (onConfirmed) this.confirmations.set(application, onConfirmed);
      this.publishConfirmation(application);
      this.plan = undefined; this.planned = undefined; this.catalog = undefined;
      if (ownerRejected) {
        this.error = reply.code === 'CONFIG_REVISION_STALE' ? msg('config.stalePlan')
          : msg('config.requestFailed', { code: reply.code ?? receipt.code ?? 'CONFIG_REQUEST_REJECTED' });
      }
      if (!noEffect || ownerRejected && reply.code === 'CONFIG_REVISION_STALE') {
        this.optionsEpoch++;
        this.optionsDue = 0;
      }
      if (valid && reply.current && !same(reply.current.account, latest.current.account)) {
        if (!same(this.effectiveCatalog?.inspection.model_options_account, reply.current.account))
          this.effectiveCatalog = undefined;
        if (!same(this.destinationCatalog?.inspection.model_options_account, reply.current.account))
          this.destinationCatalog = undefined;
      }
      if (!valid) this.error = receipt.state === 'not-sent' ? msg('config.notSent') : receipt.admission === 'rejected'
        ? msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_REQUEST_REJECTED' }) : msg('config.receiptUnknown');
      if (noEffect) {
        application.verification = 'unavailable';
        return;
      }
      this.activity = this.closed ? 'closed' : 'verifying'; this.changed();
      if (!this.closed && providerRevision === this.providerRevision) {
        try {
          const observed = await this.page(identity);
          if (providerRevision !== this.providerRevision) throw new HubError(msg('config.stalePlan'));
          this.actual = observed;
          this.reuseVerifiedPage(identity, observed);
          application.inspection = observed;
          if (application.verification !== 'unknown') application.verification = 'verified';
        } catch (reason) {
          if (application.verification !== 'unknown') application.verification = 'unavailable';
          this.error = msg('config.finalInspectFailed', { diagnostic: errorText(reason) });
        }
      } else if (application.verification !== 'unknown') application.verification = 'unavailable';
    } catch (reason) {
      this.plan = undefined; this.planned = undefined; this.error = errorText(reason);
    } finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  private reuseVerifiedPage(identity: ConfigIdentity, observed: ConfigInspect) {
    const size = this.capability?.options_page_size;
    if (!size || !validatePage(observed, observed, 0, size) || !uniqueOptions(observed.options)
      || !same(observed.model_options_account, observed.current.account)) return;
    const previous = [this.effectiveCatalog, this.destinationCatalog].find(catalog => catalog
      && same(catalog.inspection.model_options_account, observed.model_options_account)
      && catalog.inspection.options_revision === observed.options_revision
      && same(catalog.inspection.options_page.totals, observed.options_page.totals)
      && same(catalog.inspection.options, observed.options));
    if (!previous && observed.options_page.next_offset !== null) return;
    const options = copy(previous?.options ?? observed.options);
    options.accounts = options.accounts.filter(account => account.agent_id === this.observedAgentId);
    if (!isSessionProvider(this.observedAgentId)) options.models = [];
    this.storeOptions({ identity: copy(identity), inspection: observed, options });
  }
}
