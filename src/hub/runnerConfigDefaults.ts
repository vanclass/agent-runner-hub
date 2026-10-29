import type { EntryDefaults } from './singleEntry';
import type { RunnerObservation } from './runnerControl';
import { same, type ConfigCatalog, type ConfigDesired, type ConfigSettings } from './runnerConfigContract';

/** A stored profile label cannot recover the original agent/account identity. */
export function entryDefaultsToDesired(defaults: EntryDefaults, catalog: ConfigCatalog) {
  const desired: ConfigDesired = {}, unresolved: (keyof EntryDefaults)[] = [];
  const { options } = catalog;
  if (defaults.target) {
    const matches = options.targets.filter(t => defaults.target?.binding_state === 'bound'
      && t.owner === defaults.target.owner && t.project === defaults.target.project);
    if (matches.length === 1) desired.target = matches[0].id;
    else unresolved.push('target');
  }
  if (defaults.accountIdentity !== undefined) {
    if (options.accounts.some(a => same(a, defaults.accountIdentity))
      && same(defaults.accountIdentity, catalog.inspection.model_options_account)) desired.account = defaults.accountIdentity;
    else unresolved.push('accountIdentity');
  } else if (defaults.account !== undefined) {
    // Even a matching current label cannot prove a persisted label's identity.
    // The user selects the exact agent_id/profile_name pair in the API form.
    unresolved.push('account');
  }
  if (defaults.model) {
    const model = options.models.find(m => m.id === defaults.model?.model);
    if (model && model.reasoning_efforts.includes(defaults.model.reasoning_effort)
      && model.service_tiers.includes(defaults.model.service_tier) && !unresolved.includes('account')
      && !unresolved.includes('accountIdentity')) {
      desired.model = { id: model.id, reasoning_effort: defaults.model.reasoning_effort };
      desired.service_tier = defaults.model.service_tier;
    } else unresolved.push('model');
  }
  if (defaults.runMode !== undefined) {
    if (options.run_modes.includes(defaults.runMode)) desired.run_mode = defaults.runMode;
    else unresolved.push('runMode');
  }
  if (defaults.root !== undefined) {
    if (['direct-run', 'pure-direct-run'].includes(desired.run_mode ?? catalog.inspection.current.run_mode)) desired.root = defaults.root;
    else unresolved.push('root');
  }
  if (['direct-run', 'pure-direct-run'].includes(desired.run_mode ?? catalog.inspection.current.run_mode)
    && !defaults.root) unresolved.push('root');
  return { desired, unresolved };
}

export function configToEntryDefaults(settings: ConfigSettings, catalog: ConfigCatalog, observation?: RunnerObservation): EntryDefaults | undefined {
  const target = catalog.options.targets.find(t => t.id === settings.target);
  const model = catalog.options.models.find(m => m.id === settings.model.id);
  if (!target || !model || !model.reasoning_efforts.includes(settings.model.reasoning_effort)
    || !model.service_tiers.includes(settings.service_tier) || !catalog.options.run_modes.includes(settings.run_mode)
    || !same(settings.account, catalog.inspection.model_options_account)
    || !catalog.options.accounts.some(a => same(a, settings.account))
    || !observation || observation.selection.account !== settings.account.profile_name
    || !same(settings.account, catalog.inspection.current.account)) return;
  return { target: { binding_state: 'bound', owner: target.owner, project: target.project },
    accountIdentity: { ...settings.account }, runMode: settings.run_mode,
    ...(['pure-direct-run', 'direct-run'].includes(settings.run_mode) && settings.root ? { root: settings.root } : {}),
    model: { model: model.id, reasoning_effort: settings.model.reasoning_effort, service_tier: settings.service_tier } };
}
