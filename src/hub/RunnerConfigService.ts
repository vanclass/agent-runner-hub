import { msg, errorText, HubError, type HubText } from './i18n';
import { copy, same, record, isInspection, isTestSelection, sameInstallation, isPlan, isApply, isDigest, validatePage, uniqueOptions, validDesired,
  type ConfigAccount, type ConfigCapability, type ConfigCatalog, type ConfigDesired, type ConfigIdentity,
  type ConfigInspect, type ConfigPlan, type ConfigApply, type ConfigSettings, type ConfigRequest, type FeatureSnapshot,
  type FeatureAdmission, type FeatureResult, type BoundTestSelection } from './runnerConfigContract';

export interface ConfigTransport {
  identity(): ConfigIdentity | undefined;
  available(): boolean;
  submit(session: string, request: ConfigRequest): Promise<FeatureAdmission>;
}
export type ConfigActivity = 'idle' | 'inspecting' | 'catalog' | 'planning' | 'applying' | 'verifying' | 'closed';
export type ConfigApplication = { receipt: FeatureResult; result?: ConfigApply;
  plan: ConfigPlan; before: ConfigSettings;
  verification: 'pending' | 'verified' | 'unavailable' | 'unknown'; inspection?: ConfigInspect };
const terminal = (result: FeatureResult) => ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(result.state);

/** One Runner instance owns this service; drafts and receipts never enter preferences. */
export class RunnerConfigService {
  capability?: ConfigCapability;
  activity: ConfigActivity = 'idle';
  progress?: FeatureResult;
  actual?: ConfigInspect;
  catalog?: ConfigCatalog;
  draft: ConfigDesired = {};
  plan?: ConfigPlan;
  error: HubText = '';
  readonly applications: ConfigApplication[] = [];
  private presentationOffset = 0;
  private previousProgress: FeatureResult | undefined | null = null;
  get presentedApplications() { return this.applications.slice(this.presentationOffset); }
  get presentedError() { return this.progress === this.previousProgress ? '' : this.error; }
  beginPresentation() {
    this.presentationOffset = this.applications.length;
    this.previousProgress = this.progress;
  }
  private identity?: ConfigIdentity;
  private draftVersion = 0;
  private planned?: { identity: ConfigIdentity; draftVersion: number };
  private closed = false;
  private snapshot?: FeatureSnapshot;
  private receipts = new Map<number, FeatureResult>();
  private waiting?: { id?: number; identity: ConfigIdentity; request: ConfigRequest;
    finish: (result: FeatureResult) => void; timer: ReturnType<typeof setTimeout> };
  constructor(private readonly transport: ConfigTransport, private readonly changed: () => void) {}
  get busy() { return !['idle', 'closed'].includes(this.activity); }
  get latestApplication() { return this.applications.at(-1); }
  get uncertain() { return this.applications.some(a => a.verification === 'unknown' || a.result?.outcome_unknown); }
  supports(action: 'inspect' | 'plan' | 'apply') {
    return !this.closed && this.capability?.version === 1
      && this.capability.operations.includes(`session_config.${action}`) === true;
  }
  get canApply() {
    return this.supports('apply') && !this.busy && !this.uncertain && this.plan?.plan_status === 'ready'
      && !!this.planned && this.planned.draftVersion === this.draftVersion
      && same(this.planned.identity, this.transport.identity()) && this.transport.available();
  }
  getReceipt(id: number) { return this.receipts.get(id); }
  observe(session: string, state: string, snapshot?: FeatureSnapshot) {
    if (this.closed) return;
    const previousCapability = this.capability;
    let applicationChanged = false;
    const identity = state === 'ready' && snapshot && snapshot.generation > 0
      ? { session, generation: snapshot.generation } : undefined;
    if (this.identity && identity && !same(identity, this.identity)) { this.close(); return; }
    if (identity) this.identity = identity;
    this.snapshot = snapshot;
    this.capability = state === 'ready' ? snapshot?.sessionConfig ?? undefined : undefined;
    if (!this.capability) { this.catalog = undefined; this.plan = undefined; this.planned = undefined; }
    for (const receipt of snapshot?.results ?? []) {
      if (receipt.feature !== 'session_config') continue;
      if (terminal(receipt)) this.receipts.set(receipt.id, copy(receipt));
      const application = this.applications.find(a => a.receipt.id === receipt.id && a.receipt.phase !== 'completed');
      if (application && receipt.phase === 'completed' && isApply(receipt.reply, application.plan, application.before)) {
        application.receipt = copy(receipt);
        application.result = copy(receipt.reply);
        application.verification = receipt.reply.outcome_unknown ? 'unknown' : 'unavailable';
        applicationChanged = true;
      }
    }
    this.deliver();
    if (state === 'disconnected') this.close();
    else if (applicationChanged || this.waiting || !same(previousCapability, this.capability)) this.changed();
  }
  private deliver() {
    const wait = this.waiting;
    if (!wait || wait.id === undefined || !same(wait.identity, this.identity)) return;
    const result = this.snapshot?.results.find(r => r.id === wait.id && r.feature === 'session_config'
      && r.operation === wait.request.operation);
    if (!result) return;
    this.progress = copy(result);
    if (terminal(result)) wait.finish(copy(result));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.capability = undefined;
    this.catalog = undefined;
    this.plan = undefined;
    this.planned = undefined;
    const wait = this.waiting;
    if (wait) wait.finish(this.unknown(wait.request, wait.id));
    this.activity = 'closed';
    this.changed();
  }
  private unknown(request: ConfigRequest, id = 0): FeatureResult {
    return { id, feature: 'session_config', operation: request.operation, state: 'outcome-unknown',
      admission: this.progress?.id === id ? this.progress.admission : 'unconfirmed', code: 'CONFIG_RECEIPT_UNAVAILABLE' };
  }
  private assertIdentity(identity: ConfigIdentity) {
    if (this.closed || !same(identity, this.transport.identity()) || !same(identity, this.identity))
      throw new HubError(msg('config.identityChanged'));
  }
  private request(request: ConfigRequest): Promise<FeatureResult> {
    const identity = this.transport.identity();
    const action = request.operation.split('.')[1] as 'inspect' | 'plan' | 'apply';
    if (!identity || !this.supports(action) || this.waiting) throw new HubError(msg('config.unsupported'));
    this.assertIdentity(identity);
    this.progress = { id: 0, feature: 'session_config', operation: request.operation,
      state: 'sending', admission: 'unconfirmed' };
    this.changed();
    return new Promise(resolve => {
      const finish = (result: FeatureResult) => {
        if (this.waiting?.finish !== finish) return;
        clearTimeout(this.waiting.timer);
        this.waiting = undefined;
        this.progress = result;
        if (result.id) this.receipts.set(result.id, copy(result));
        this.changed();
        resolve(result);
      };
      // Native owns the FIFO-head deadline; this is a bounded delivery grace.
      const timer = setTimeout(() => finish(this.unknown(request, this.waiting?.id)),
        (action === 'apply' ? 1830 : action === 'plan' ? 630 : 450) * 1000);
      this.waiting = { identity: copy(identity), request, finish, timer };
      void this.transport.submit(identity.session, request).then(admission => {
        if (this.waiting?.finish !== finish) return;
        if (admission.state !== 'submitted') {
          finish({ ...this.unknown(request), state: admission.state,
            admission: admission.state === 'not-sent' ? 'not-sent' : 'unconfirmed', code: admission.detail });
          return;
        }
        if (admission.generation !== identity.generation) { finish(this.unknown(request, admission.id)); return; }
        this.waiting.id = admission.id;
        this.deliver();
      }, () => finish(this.unknown(request, this.waiting?.id)));
    });
  }
  private completion(receipt: FeatureResult) {
    if (receipt.admission === 'rejected') throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_REQUEST_REJECTED' }));
    if (receipt.phase !== 'completed' || !['accepted', 'rejected', 'failure', 'outcome-unknown'].includes(receipt.state))
      throw new HubError(msg(receipt.state === 'not-sent' ? 'config.notSent' : 'config.receiptUnknown'));
    return receipt.reply;
  }
  private async page(identity: ConfigIdentity, account?: ConfigAccount, offset = 0, guard?: string) {
    this.assertIdentity(identity);
    const receipt = await this.request({ operation: 'session_config.inspect', api_version: 1, offset,
      ...(account ? { account: copy(account) } : {}), ...(guard ? { options_revision: guard } : {}) });
    this.assertIdentity(identity);
    const reply = this.completion(receipt);
    if (receipt.state !== 'accepted' || !isInspection(reply))
      throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_INSPECTION_FAILED' }));
    return copy(reply);
  }
  /** Read-only admission evidence for explicit native acceptance, never a preference. */
  async selectTestAccount(): Promise<BoundTestSelection | undefined> {
    if (this.busy || this.closed || this.uncertain) return;
    const identity = this.transport.identity(), root = this.snapshot?.runnerRoot;
    this.activity = 'inspecting'; this.error = ''; this.changed();
    try {
      if (!identity || !root || !this.transport.available() || this.capability?.test_account_selection !== true)
        throw new Error('TEST_ACCOUNT_SELECTION_UNSUPPORTED');
      this.assertIdentity(identity);
      const receipt = await this.request({ operation: 'session_config.inspect', api_version: 1, execution_context: 'test' });
      this.assertIdentity(identity);
      const reply = this.completion(receipt);
      if (receipt.state !== 'accepted' || !isTestSelection(reply)) {
        const details = record(reply) ? [reply.actual_result, reply.recommended_next_action]
          .filter((s): s is string => typeof s === 'string' && !!s) : [];
        throw new Error([receipt.code ?? 'TEST_ACCOUNT_EVIDENCE_UNVERIFIED', ...details].join('. '));
      }
      if (this.snapshot?.runnerRoot !== root || !sameInstallation(reply.runner_root, root))
        throw new Error('TEST_ACCOUNT_INSTALLATION_MISMATCH');
      return { identity: copy(identity), selection: copy(reply) };
    } catch (reason) {
      this.error = `${String(reason instanceof Error ? reason.message : reason)}. Configure /account → Test account settings in the opened Runner installation.`;
      return undefined;
    } finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  async inspect(account?: ConfigAccount) {
    this.previousProgress = null;
    if (this.busy || this.closed) return;
    this.activity = account ? 'catalog' : 'inspecting';
    this.error = '';
    this.catalog = undefined;
    this.plan = undefined;
    this.planned = undefined;
    this.changed();
    const version = this.draftVersion;
    try {
      const identity = this.transport.identity();
      if (!identity) throw new HubError(msg('config.notReady'));
      const cap = this.capability;
      if (!cap || !this.supports('inspect')) throw new HubError(msg('config.unsupported'));
      const first = await this.page(identity, account);
      this.actual = first;
      for (const application of this.applications) {
        if (application.result && application.verification === 'unavailable') {
          application.verification = 'verified'; application.inspection = copy(first);
        }
      }
      if (account && !same(first.model_options_account, account)) throw new HubError(msg('config.identityChanged'));
      if (!account && !same(first.model_options_account, first.current.account)) throw new HubError(msg('config.identityChanged'));
      if (cap.options_revision && !isDigest(first.options_revision)) throw new HubError(msg('config.incomplete'));
      const options = copy(first.options);
      let page = first, offset = 0;
      for (;;) {
        if (!validatePage(page, first, offset, cap.options_page_size, cap.options_revision)) throw new HubError(msg('config.incomplete'));
        if (page.options_page.next_offset === null) break;
        if (!cap.options_revision) throw new HubError(msg('config.legacyPages'));
        offset = page.options_page.next_offset;
        page = await this.page(identity, account, offset, first.options_revision!);
        for (const key of ['targets', 'accounts', 'models'] as const) {
          // Concatenate only after validating this page; publish only at terminal null.
          if (!validatePage(page, first, offset, cap.options_page_size, true)) throw new HubError(msg('config.incomplete'));
          (options[key] as unknown[]).push(...page.options[key]);
        }
        if (!uniqueOptions(options)) throw new HubError(msg('config.identityChanged'));
      }
      if (!uniqueOptions(options) || (account && !options.accounts.some(a => same(a, account))))
        throw new HubError(msg('config.identityChanged'));
      this.assertIdentity(identity);
      if (version !== this.draftVersion) throw new HubError(msg('config.draftChanged'));
      this.catalog = { identity: copy(identity), account: copy(account), inspection: first, options };
    } catch (reason) { this.catalog = undefined; this.error = errorText(reason); }
    finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
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
  async createPlan() {
    this.previousProgress = null;
    if (this.busy || this.closed) return;
    this.error = '';
    this.plan = undefined;
    this.planned = undefined;
    const identity = this.transport.identity(), version = this.draftVersion, desired = copy(this.draft);
    if (!identity || !this.actual || !this.catalog || !same(identity, this.catalog.identity)
      || !validDesired(desired, this.actual.current, this.catalog) || !this.transport.available()) {
      this.error = msg('config.invalidCombination'); this.changed(); return;
    }
    this.activity = 'planning'; this.changed();
    try {
      const receipt = await this.request({ operation: 'session_config.plan', api_version: 1, desired });
      this.assertIdentity(identity);
      const reply = this.completion(receipt);
      if (!isPlan(reply) || !same(reply.desired, desired) || (reply.plan_status === 'ready' && receipt.state !== 'accepted'))
        throw new HubError(msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_PLAN_MISMATCH' }));
      if (version !== this.draftVersion) throw new HubError(msg('config.draftChanged'));
      this.plan = copy(reply);
      this.planned = { identity: copy(identity), draftVersion: version };
    } catch (reason) { this.error = errorText(reason); }
    finally { if (!this.closed) this.activity = 'idle'; this.changed(); }
  }
  async apply() {
    if (!this.canApply || !this.plan || !this.planned) return;
    const plan = copy(this.plan), identity = copy(this.planned.identity), version = this.draftVersion;
    this.activity = 'verifying'; this.error = ''; this.changed();
    try {
      const latest = await this.page(identity);
      this.actual = latest;
      if (version !== this.draftVersion || latest.revision !== plan.revision) throw new HubError(msg('config.stalePlan'));
      this.activity = 'applying'; this.changed();
      const receipt = await this.request({ operation: 'session_config.apply', api_version: 1,
        desired: copy(plan.desired), revision: plan.revision, plan_id: plan.plan_id! });
      const reply = receipt.phase === 'completed' ? receipt.reply : undefined;
      const valid = isApply(reply, plan, latest.current);
      const noEffect = receipt.state === 'not-sent' || receipt.admission === 'rejected';
      const application: ConfigApplication = { receipt: copy(receipt), result: valid ? copy(reply) : undefined,
        plan: copy(plan), before: copy(latest.current),
        verification: noEffect ? 'pending' : !valid || receipt.state === 'outcome-unknown' || (valid && reply.outcome_unknown) ? 'unknown' : 'pending' };
      // This record is independent of the following read; confirmed receipts survive it.
      this.applications.push(application);
      this.plan = undefined; this.planned = undefined; this.catalog = undefined;
      if (!valid) this.error = receipt.state === 'not-sent' ? msg('config.notSent') : receipt.admission === 'rejected'
        ? msg('config.requestFailed', { code: receipt.code ?? 'CONFIG_REQUEST_REJECTED' }) : msg('config.receiptUnknown');
      this.activity = this.closed ? 'closed' : 'verifying'; this.changed();
      if (!this.closed) {
        try {
          const observed = await this.page(identity);
          this.actual = observed;
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
}
