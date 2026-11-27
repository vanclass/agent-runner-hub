import { msg, errorText, HubError, type HubText } from './i18n';
import { projectEntryDefaults } from './preferences';
import type { EntryDefaults } from './singleEntry';
import type { RunnerConfigService } from './RunnerConfigService';
import { copy, same, isSessionProvider, type ConfigCatalog } from './runnerConfigContract';
import { configToEntryDefaults, currentProviderDefaults } from './runnerConfigDefaults';
import type { RunnerObservation } from './runnerControl';
import { runModes } from './runnerWork';
import type { RunMode } from './RunnerNavigation';

/** Saved requests win; only new selections adopt verified current Runner defaults. */
export class HubSelections {
  defaults: EntryDefaults;
  catalog?: ConfigCatalog;
  loadingOptions = false;
  detail: HubText = '';
  readonly restoredDefaults: boolean;
  private attempted?: RunnerConfigService;
  private attemptedRevision?: number;
  private providerSource?: RunnerConfigService;
  private providerRevision?: number;
  private provider?: string;
  private refreshProvider = false;
  private inspectionEdits?: Set<keyof EntryDefaults>;
  constructor(private readonly source: () => RunnerConfigService | undefined,
    private readonly changed: () => void, defaults: EntryDefaults = {},
    private readonly save: (value: EntryDefaults) => void = () => {},
    private readonly canEdit: () => boolean = () => true,
    private readonly observation: (service: RunnerConfigService) => RunnerObservation | undefined = () => undefined,
    private readonly initialMode?: RunMode,
    private readonly commitTabMode?: (mode: RunMode) => void) {
    this.defaults = projectEntryDefaults(defaults) ?? {};
    this.restoredDefaults = Object.keys(this.defaults).some(key => key !== 'allocationPolicy'
      && (initialMode === undefined || key !== 'root'));
    if (initialMode !== undefined) this.defaults.runMode = initialMode;
  }
  get editable() { return this.canEdit(); }
  get effectiveAgentId() {
    return this.source()?.observedAgentId;
  }
  get configuredStartupAgentId() {
    const service = this.source();
    return service && this.observation(service)?.configured_startup_agent_id;
  }
  get initialized() {
    return this.restoredDefaults || Object.keys(this.defaults).some(key => !['allocationPolicy', 'root'].includes(key)
      && (this.initialMode === undefined || key !== 'runMode'));
  }
  initialize() {
    // Inspection itself temporarily hides a busy spare from the source supplier.
    if (this.loadingOptions && this.attempted?.busy) return;
    const service = this.source();
    const unsupported = msg('config.unsupported');
    if (same(this.detail, unsupported) && !service?.inspectionUnsupported) {
      this.detail = ''; this.changed();
    }
    if (!service || !service.supports('inspect') || this.attempted && this.attempted !== service) {
      this.attempted = undefined;
      this.catalog = undefined;
    }
    if (this.attempted && service?.providerRevision !== this.attemptedRevision) {
      this.attempted = undefined;
      this.catalog = undefined;
    }
    if (this.loadingOptions || !this.editable || !service) return;
    if (!service.supports('inspect')) {
      if (service.inspectionUnsupported && !this.detail) {
        this.detail = unsupported; this.changed();
      }
      return;
    }
    if (service.busy) return;
    this.observeProvider(service);
    if (this.observation(service)?.attention?.foreground_interaction_active) return;
    const catalog = service.catalog;
    // Publication can lose readiness after inspection; reuse verified evidence, not a failed inspection.
    const observation = this.observation(service);
    const recovered = !this.catalog && catalog && same(catalog.account, this.defaults.accountIdentity)
      && (this.refreshProvider ? observation?.selection.agent_id === service.observedAgentId && !!observation
        : catalog.options.run_modes.includes('task-run')
          && ['target', 'account', 'run_mode', 'model', 'service_tier'].every(key => catalog.inspection.availability[key] === true)
          && configToEntryDefaults(catalog.inspection.current, catalog, observation));
    if (this.attempted === service && !recovered) return;
    void this.loadOptions(!!recovered);
  }
  private savedProviders() {
    const { providerPreferences, accountIdentity, model } = this.defaults;
    if (providerPreferences) return copy(providerPreferences);
    const saved: NonNullable<EntryDefaults['providerPreferences']> = {};
    if (isSessionProvider(accountIdentity?.agent_id)) saved[accountIdentity.agent_id] = { accountIdentity };
    if (isSessionProvider(model?.agent_id)) saved[model.agent_id] = { ...saved[model.agent_id], model };
    return saved;
  }
  private observeProvider(service: RunnerConfigService) {
    const provider = service.observedAgentId;
    const sameSource = this.providerSource === service;
    if (sameSource && this.providerRevision === service.providerRevision) return;
    const previous = this.provider;
    const first = !this.providerSource;
    this.providerSource = service;
    this.providerRevision = service.providerRevision;
    this.provider = provider;
    const { accountIdentity, model, providerPreferences } = this.defaults;
    const incompatible = [accountIdentity?.agent_id, model?.agent_id]
      .some(id => isSessionProvider(id) && id !== provider);
    if ((first && !incompatible && !providerPreferences) || (!first && !sameSource && previous === provider)) return;
    const saved = this.savedProviders();
    const picks = isSessionProvider(provider) ? saved[provider] : undefined;
    this.defaults = { ...this.defaults, providerPreferences: saved,
      accountIdentity: picks?.accountIdentity ?? (accountIdentity && !isSessionProvider(accountIdentity.agent_id) ? accountIdentity : undefined),
      model: picks?.model ?? (model && !isSessionProvider(model.agent_id) ? model : undefined) };
    this.refreshProvider = true;
  }
  canSetTabMode(mode: RunMode) {
    return !!(this.commitTabMode && this.editable && !this.loadingOptions && this.source()
      && this.choiceAllowed('runMode', mode));
  }
  setTabMode(mode: RunMode, commitOrder: () => void) {
    if (this.canSetTabMode(mode)) this.updateDefault('runMode', mode, commitOrder);
  }
  setDefault<K extends keyof EntryDefaults>(key: K, value: EntryDefaults[K]) {
    this.updateDefault(key, value);
  }
  private updateDefault<K extends keyof EntryDefaults>(key: K, value: EntryDefaults[K], commitOrder?: () => void) {
    if (!this.editable) return;
    if (key === 'runMode' && this.commitTabMode
      && (this.loadingOptions || value === undefined || !this.source())) return;
    const projected = projectEntryDefaults({ ...this.defaults, [key]: value,
      ...(!['allocationPolicy', 'root'].includes(key) ? { initialized: true } : {}) });
    if (!projected || value !== undefined && !this.choiceAllowed(key, value)) return;
    const provider = this.effectiveAgentId;
    if ((key === 'accountIdentity' || key === 'model') && isSessionProvider(provider)) {
      const saved = this.savedProviders();
      saved[provider] = { ...saved[provider], [key]: projected[key] ?? null };
      projected.providerPreferences = saved;
    }
    this.inspectionEdits?.add(key);
    const committedMode = key === 'runMode' && (commitOrder || projected.runMode !== this.defaults.runMode)
      ? projected.runMode as RunMode : undefined;
    this.defaults = projected;
    if (committedMode) this.commitTabMode?.(committedMode);
    commitOrder?.();
    this.save(copy(projected));
    this.changed();
    if (key === 'accountIdentity') void this.inspectOptions();
  }
  private choiceAllowed(key: keyof EntryDefaults, value: unknown) {
    if (key === 'allocationPolicy' || key === 'root') return true;
    const catalog = this.catalog, options = catalog?.options;
    if (!options) return false;
    if (key === 'accountIdentity') return options.accounts.some(a => a.agent_id === this.effectiveAgentId && same(a, value));
    if (key === 'target') return options.targets.some(t => same({ binding_state: 'bound', owner: t.owner, project: t.project }, value));
    if (key === 'runMode') return runModes.includes(value as typeof runModes[number]) && options.run_modes.includes(String(value));
    if (key === 'model') {
      const model = value as NonNullable<EntryDefaults['model']>;
      const previous = this.defaults.model?.agent_id === model.agent_id ? this.defaults.model : undefined;
      return !!model.agent_id && model.agent_id === this.effectiveAgentId
        && same(this.defaults.accountIdentity, catalog.inspection.model_options_account)
        && options.models.some(m => m.id === model.model
          && (m.reasoning_efforts.includes(model.reasoning_effort) || model.reasoning_effort === previous?.reasoning_effort)
          && (m.service_tiers.includes(model.service_tier) || model.service_tier === previous?.service_tier));
    }
    return false;
  }
  inspectOptions() { return this.loadOptions(false); }
  private async loadOptions(reuseCatalog: boolean) {
    if (!this.editable || this.loadingOptions) return;
    const service = this.source();
    if (service?.busy) { this.attempted = undefined; return; }
    if (service?.supports('inspect')) this.observeProvider(service);
    const before = this.defaults, initialize = !this.initialized;
    this.attempted = service;
    const revision = this.attemptedRevision = service?.providerRevision;
    const edits = this.inspectionEdits = new Set<keyof EntryDefaults>();
    this.loadingOptions = true; this.catalog = undefined; this.detail = msg('config.inspecting'); this.changed();
    try {
      if (!service?.supports('inspect') || service.busy) throw new HubError(msg('config.notReady'));
      if (!reuseCatalog) await service.inspect(before.accountIdentity);
      let catalog = service.catalog;
      if (!catalog && before.accountIdentity && this.defaults === before && this.source() === service
        && revision === service.providerRevision) {
        // Keep an unsupported saved identity, but expose verified alternatives for an explicit edit.
        await service.inspect();
        catalog = service.catalog;
      }
      if (!catalog) throw new HubError(service.error || msg('config.incomplete'));
      if (!this.editable || this.source() !== service || this.attempted !== service || revision !== service.providerRevision) {
        this.detail = msg('config.incomplete');
        return;
      }
      const observation = this.observation(service);
      if (this.refreshProvider && isSessionProvider(service.observedAgentId) && !observation) {
        this.detail = msg('config.incomplete');
        return;
      }
      if (!edits.has('accountIdentity')) this.catalog = copy(catalog);
      if (this.refreshProvider) {
        const provider = service.observedAgentId;
        const picks = isSessionProvider(provider) ? this.defaults.providerPreferences?.[provider] : undefined;
        const current = currentProviderDefaults(catalog.inspection.current, catalog, observation);
        const accountIdentity = this.defaults.accountIdentity ?? (picks?.accountIdentity === undefined ? current?.accountIdentity : undefined);
        const model = this.defaults.model ?? (picks?.model === undefined && same(accountIdentity, current?.accountIdentity)
          ? current?.model : undefined);
        this.defaults = { ...this.defaults, accountIdentity, model };
        this.refreshProvider = false;
      }
      if (initialize) {
        if (!catalog.inspection.current.target) {
          this.detail = msg('config.chooseTarget');
          return;
        }
        const available = catalog.inspection.availability;
        const current = configToEntryDefaults(catalog.inspection.current, catalog, observation);
        if (!current || !catalog.options.run_modes.includes('task-run')
          || !['target', 'account', 'run_mode', 'model', 'service_tier'].every(key => available[key] === true))
          throw new HubError(msg('config.incomplete'));
        const initial: EntryDefaults = { ...current, initialized: true, runMode: 'task-run' };
        if (this.initialMode !== undefined) delete initial.root;
        // Account edits invalidate dependent model defaults, including explicit account clears.
        for (const key of edits) delete initial[key];
        if (edits.has('accountIdentity')) delete initial.model;
        const projected = projectEntryDefaults({ ...initial, ...this.defaults, initialized: true,
          providerPreferences: this.defaults.providerPreferences ?? {} });
        if (!projected) throw new HubError(msg('config.incomplete'));
        this.defaults = projected;
        this.save(copy(projected));
      }
      this.detail = before.accountIdentity && !same(before.accountIdentity, catalog.inspection.model_options_account)
        ? msg('config.defaultsUnresolved', { fields: 'accountIdentity' }) : '';
    } catch (reason) {
      this.catalog = undefined;
      this.detail = this.source() === service ? errorText(reason) : msg('config.incomplete');
    } finally {
      if (edits.has('accountIdentity')) this.attempted = undefined;
      this.inspectionEdits = undefined; this.loadingOptions = false; this.changed();
      this.initialize();
    }
  }
}
