import { msg, errorText, HubError, type HubText } from './i18n';
import { projectEntryDefaults } from './preferences';
import type { EntryDefaults } from './singleEntry';
import type { RunnerConfigService } from './RunnerConfigService';
import { copy, same, type ConfigCatalog } from './runnerConfigContract';
import { configToEntryDefaults } from './runnerConfigDefaults';
import type { RunnerObservation } from './runnerControl';

/** Saved requests win; only new selections adopt verified current Runner defaults. */
export class HubSelections {
  defaults: EntryDefaults;
  catalog?: ConfigCatalog;
  loadingOptions = false;
  detail: HubText = '';
  readonly restoredDefaults: boolean;
  private attempted = false;
  private inspectionEdits?: Set<keyof EntryDefaults>;
  constructor(private readonly source: () => RunnerConfigService | undefined,
    private readonly changed: () => void, defaults: EntryDefaults = {},
    private readonly save: (value: EntryDefaults) => void = () => {},
    private readonly canEdit: () => boolean = () => true,
    private readonly observation: (service: RunnerConfigService) => RunnerObservation | undefined = () => undefined) {
    this.defaults = projectEntryDefaults(defaults) ?? {};
    this.restoredDefaults = Object.keys(this.defaults).some(key => key !== 'allocationPolicy');
  }
  get editable() { return this.canEdit(); }
  get initialized() {
    return this.restoredDefaults || Object.keys(this.defaults).some(key => !['allocationPolicy', 'root'].includes(key));
  }
  initialize() {
    if (this.attempted || this.loadingOptions || !this.editable) return;
    const service = this.source();
    if (!service) return;
    if (!service.supports('inspect')) {
      const detail = msg('config.unsupported');
      if (!same(this.detail, detail)) { this.detail = detail; this.changed(); }
      return;
    }
    if (service.busy) return;
    this.attempted = true;
    void this.inspectOptions();
  }
  setDefault<K extends keyof EntryDefaults>(key: K, value: EntryDefaults[K]) {
    if (!this.editable) return;
    const projected = projectEntryDefaults({ ...this.defaults, [key]: value,
      ...(!['allocationPolicy', 'root'].includes(key) ? { initialized: true } : {}) });
    if (!projected || value !== undefined && !this.choiceAllowed(key, value)) return;
    this.inspectionEdits?.add(key);
    this.defaults = projected;
    this.save(copy(projected));
    this.changed();
    if (key === 'accountIdentity') void this.inspectOptions();
  }
  private choiceAllowed(key: keyof EntryDefaults, value: unknown) {
    if (key === 'allocationPolicy' || key === 'root') return true;
    const catalog = this.catalog, options = catalog?.options;
    if (!options) return false;
    if (key === 'accountIdentity') return options.accounts.some(a => same(a, value));
    if (key === 'target') return options.targets.some(t => same({ binding_state: 'bound', owner: t.owner, project: t.project }, value));
    if (key === 'runMode') return options.run_modes.includes(String(value));
    if (key === 'model') {
      const model = value as NonNullable<EntryDefaults['model']>;
      return same(this.defaults.accountIdentity, catalog.inspection.model_options_account)
        && options.models.some(m => m.id === model.model
          && (m.reasoning_efforts.includes(model.reasoning_effort) || model.reasoning_effort === this.defaults.model?.reasoning_effort)
          && (m.service_tiers.includes(model.service_tier) || model.service_tier === this.defaults.model?.service_tier));
    }
    return false;
  }
  async inspectOptions() {
    if (!this.editable || this.loadingOptions) return;
    this.attempted = true;
    const before = this.defaults, initialize = !this.initialized, service = this.source();
    const edits = this.inspectionEdits = new Set<keyof EntryDefaults>();
    this.loadingOptions = true; this.catalog = undefined; this.detail = msg('config.inspecting'); this.changed();
    try {
      if (!service?.supports('inspect') || service.busy) throw new HubError(msg('config.notReady'));
      await service.inspect(before.accountIdentity);
      let catalog = service.catalog;
      if (!catalog && before.accountIdentity && this.defaults === before) {
        // Keep an unsupported saved identity, but expose verified alternatives for an explicit edit.
        await service.inspect();
        catalog = service.catalog;
      }
      if (!catalog) throw new HubError(service.error || msg('config.incomplete'));
      if (!this.editable || this.source() !== service) {
        this.detail = msg('config.draftChanged');
        return;
      }
      this.catalog = copy(catalog);
      if (initialize) {
        const available = catalog.inspection.availability;
        const current = configToEntryDefaults(catalog.inspection.current, catalog, this.observation(service));
        if (!current || !catalog.options.run_modes.includes('task-run')
          || !['target', 'account', 'run_mode', 'model', 'service_tier'].every(key => available[key] === true))
          throw new HubError(msg('config.incomplete'));
        const initial: EntryDefaults = { ...current, initialized: true, runMode: 'task-run' };
        // Account edits invalidate dependent model defaults, including explicit account clears.
        for (const key of edits) delete initial[key];
        if (edits.has('accountIdentity')) delete initial.model;
        const projected = projectEntryDefaults({ ...initial, ...this.defaults, initialized: true });
        if (!projected) throw new HubError(msg('config.incomplete'));
        this.defaults = projected;
        this.save(copy(projected));
      }
      this.detail = before.accountIdentity && !same(before.accountIdentity, catalog.inspection.model_options_account)
        ? msg('config.defaultsUnresolved', { fields: 'accountIdentity' }) : '';
    } catch (reason) { this.catalog = undefined; this.detail = errorText(reason); }
    finally { this.inspectionEdits = undefined; this.loadingOptions = false; this.changed(); }
  }
}
