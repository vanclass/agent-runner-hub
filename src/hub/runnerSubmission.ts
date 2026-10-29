import { HubError, msg } from './i18n';
import type { EntryDefaults } from './singleEntry';
import type { RunnerConfigService } from './RunnerConfigService';
import type { RunnerWork } from './runnerWork';
import { entryDefaultsToDesired } from './runnerConfigDefaults';
import { same } from './runnerConfigContract';

/** Both entry points use the destination's authenticated configuration and work owners. */
export async function submitConfiguredWork(config: RunnerConfigService, work: RunnerWork,
  defaults: EntryDefaults, instruction: string, admit: () => Promise<symbol | void>) {
  if (!work.supported || work.blocked || work.busy) throw new HubError(msg('work.unavailable'));
  if (config.busy || config.uncertain) throw new HubError(msg('config.partial'));
  config.resetDraft();
  await config.inspect(defaults.accountIdentity);
  if (!config.catalog || !config.actual) throw new HubError(config.error || msg('config.incomplete'));
  const mapped = entryDefaultsToDesired(defaults, config.catalog);
  if (mapped.unresolved.length) throw new HubError(msg('config.defaultsUnresolved', { fields: mapped.unresolved.join(', ') }));
  config.setDraft(mapped.desired);
  await config.createPlan();
  const plan = config.plan;
  if (!config.canApply || plan?.plan_status !== 'ready' || plan.errors.length || plan.required_confirmations.length)
    throw new HubError(config.error || msg('config.confirmation'));
  if (Object.keys(plan.changes).length) {
    await config.apply();
    const application = config.latestApplication;
    if (config.uncertain || config.error || application?.result?.apply_status !== 'applied'
      || application.verification !== 'verified' || !application.inspection)
      throw new HubError(config.error || msg('config.partial'));
  } else {
    // A ready no-op plan needs verification, but no mutating Apply request.
    await config.inspect(defaults.accountIdentity);
    if (config.error || !config.catalog) throw new HubError(config.error || msg('config.incomplete'));
  }
  const inspection = config.actual;
  if (!inspection || inspection.setup_required || !Object.entries(mapped.desired).every(([key, value]) =>
    same(inspection.current[key as keyof typeof inspection.current], value))) throw new HubError(msg('config.stalePlan'));
  const attachmentLease = await admit();
  return work.submit(instruction, attachmentLease || undefined);
}
