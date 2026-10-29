import { msg, errorText, HubError, type HubText } from './i18n';
import { projectEntryDefaults } from './preferences';
import type { EntryDefaults } from './singleEntry';
import type { RunnerConfigService } from './RunnerConfigService';
import { copy, same, type ConfigCatalog } from './runnerConfigContract';

/** Requested Hub choices only; inspection never adopts current/effective Runner settings. */
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
    private readonly canEdit: () => boolean = () => true) {
    this.defaults = projectEntryDefaults(defaults) ?? {};
    this.restoredDefaults = Object.keys(this.defaults).some(key => key !== 'allocationPolicy');
  }
  get editable() { return this.canEdit(); }
  get initialized() {
    return this.restoredDefaults || Object.keys(this.defaults).some(key => !['allocationPolicy', 'root'].includes(key));
  }
  initialize() {
    if (this.initialized || this.attempted || !this.editable) return;
    const service = this.source();
    if (!service?.supports('inspect') || service.busy) return;
    this.attempted = true;
    void this.inspectOptions();
  }
  setDefault<K extends keyof EntryDefaults>(key: K, value: EntryDefaults[K]) {
    if (!this.editable) return;
    const projected = projectEntryDefaults({ ...this.defaults, [key]: value,
      ...(!['allocationPolicy', 'root'].includes(key) ? { initialized: true } : {}) });
    if (!projected || value !== undefined && !this.choiceAllowed(key, value)) return;
    if (key === 'accountIdentity') delete projected.account;
    if (key === 'runMode' && !['direct-run', 'pure-direct-run'].includes(String(value))) delete projected.root;
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
      if (initialize) {
        const account = catalog.options.accounts[0];
        if (!account) throw new HubError(msg('config.incomplete'));
        // Resolve the first candidate account itself, even if current uses another account.
        await service.inspect(account);
        catalog = service.catalog;
        if (!catalog || !same(catalog.inspection.model_options_account, account)
          || !same(catalog.options.accounts[0], account)) throw new HubError(service.error || msg('config.incomplete'));
      }
      if ((!initialize && this.defaults !== before) || !this.editable || this.source() !== service) {
        this.detail = msg('config.draftChanged');
        return;
      }
      this.catalog = copy(catalog);
      if (initialize) {
        const { targets, accounts, run_modes, models } = catalog.options;
        const model = models[0], available = catalog.inspection.availability;
        if (!targets[0] || !accounts[0] || !run_modes[0] || !model?.reasoning_efforts[0] || !model.service_tiers[0]
          || !['target', 'account', 'run_mode', 'model', 'service_tier'].every(key => available[key] === true))
          throw new HubError(msg('config.incomplete'));
        const initial: EntryDefaults = { initialized: true,
          target: { binding_state: 'bound', owner: targets[0].owner, project: targets[0].project },
          accountIdentity: accounts[0], runMode: run_modes[0], model: { model: model.id,
            reasoning_effort: model.reasoning_efforts[0], service_tier: model.service_tiers[0] } };
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
