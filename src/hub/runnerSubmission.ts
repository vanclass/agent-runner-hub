import { HubError, msg } from './i18n';
import type { EntryDefaults } from './singleEntry';
import type { RunnerConfigService } from './RunnerConfigService';
import type { RunnerWork } from './runnerWork';
import { entryDefaultsToDesired } from './runnerConfigDefaults';
import { same } from './runnerConfigContract';
import type { WorkAttempt } from './runnerWork';
import type { ConfigCatalog } from './runnerConfigContract';

/** Inspect only Runner's leading block; keep explicit metadata for Runner admission. */
export function prepareTaskRunInstruction(instruction: string, target: EntryDefaults['target'], catalog: ConfigCatalog): string {
  // Python str.strip whitespace, excluding BOM (accepted only on the heading).
  const strip = (text: string) => text.replace(/^(?:[^\S\uFEFF]|[\x1c-\x1f\x85])+|(?:[^\S\uFEFF]|[\x1c-\x1f\x85])+$/g, '');
  const lines = instruction.match(/[^\r\n\v\f\x1c-\x1e\x85\u2028\u2029]*(?:\r\n|[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]|$)/g) ?? [];
  const header = lines.findIndex(line => strip(line));
  const leading = header >= 0 && strip(lines[header]).replace(/^\uFEFF/, '') === 'Target';
  const fields = new Set<string>();
  if (leading) for (const line of lines.slice(header + 1)) {
    const content = strip(strip(line).replace(/^[-*] /, ''));
    if (!content) continue;
    const colon = content.indexOf(':');
    if (colon < 0) break;
    const key = strip(content.slice(0, colon)).toLowerCase().replace(/\u017f/g, 's'), value = strip(content.slice(colon + 1));
    if (!key || !value) return instruction;
    if (!['owner', 'project', 'reasoning'].includes(key)) continue;
    if (fields.has(key)) return instruction;
    fields.add(key);
    if (key === 'reasoning' && !['minimum', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)) return instruction;
    if (key === 'owner' && !['Workspace', 'Project'].includes(value)) return instruction;
  }

  const missing = ['owner', 'project'].filter(key => !fields.has(key));
  if (!missing.length) return instruction;
  const matches = catalog.options.targets.filter(option => target?.binding_state === 'bound'
    && option.owner === target.owner && option.project === target.project);
  if (matches.length !== 1) throw new HubError(msg('config.defaultsUnresolved', { fields: 'target' }));
  const selected = matches[0];
  const values = { owner: selected.owner, project: selected.owner === 'Workspace' ? 'codex_workspace' : selected.project };
  const eol = instruction.match(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)?.[0] ?? '\n';
  const additions = missing.map(key => `${key === 'owner' ? 'Owner' : 'Project'}: ${values[key as keyof typeof values]}${eol}`).join('');
  if (!leading) {
    // Blank lines do not end Runner metadata; a field-first body needs a heading.
    const boundary = header >= 0 && lines[header].includes(':') ? `Goal${eol}` : '';
    return `Target${eol}${additions}${eol}${boundary}${instruction}`;
  }
  const offset = lines.slice(0, header + 1).join('').length;
  const separator = /[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]$/.test(lines[header]) ? '' : eol;
  return instruction.slice(0, offset) + separator + additions + instruction.slice(offset);
}

/** Both entry points use the destination's authenticated configuration and work owners. */
export async function submitConfiguredWork<T = WorkAttempt>(config: RunnerConfigService, work: RunnerWork,
  defaults: EntryDefaults, instruction: string, admit: () => Promise<symbol | void>,
  deliver?: (lease?: symbol) => Promise<T>): Promise<T> {
  if ((!deliver && !work.supports('work.submit', defaults.runMode)) || work.blocked || work.busy)
    throw new HubError(msg('work.unavailable'));
  if (config.busy || config.uncertain) throw new HubError(msg('config.partial'));
  config.resetDraft();
  await config.inspect(defaults.accountIdentity);
  if (!config.catalog || !config.actual) throw new HubError(config.error || msg('config.incomplete'));
  const taskRun = (defaults.runMode ?? config.actual.current.run_mode) === 'task-run';
  const prepared = taskRun ? prepareTaskRunInstruction(instruction, defaults.target, config.catalog) : instruction;
  // TaskRun owns identity and tier resolution in its instruction, including session-pair fallback.
  const mapped = entryDefaultsToDesired(taskRun ? { ...defaults, target: undefined, model: undefined } : defaults, config.catalog);
  if (!defaults.accountIdentity) throw new HubError(msg('config.defaultsUnresolved', { fields: 'accountIdentity' }));
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
  } else if (plan.revision !== config.actual?.revision) {
    // Reinspect only when the canonical no-op plan observed a different configuration.
    await config.inspect(defaults.accountIdentity);
    if (config.error || !config.catalog) throw new HubError(config.error || msg('config.incomplete'));
  }
  const inspection = config.actual;
  if (!inspection || inspection.setup_required || !Object.entries(mapped.desired).every(([key, value]) =>
    same(inspection.current[key as keyof typeof inspection.current], value))) throw new HubError(msg('config.stalePlan'));
  const attachmentLease = await admit();
  if (deliver && (defaults.runMode !== 'issue-run' || inspection.current.run_mode !== 'issue-run'))
    throw new HubError(msg('brief.unavailable'));
  return deliver ? deliver(attachmentLease || undefined)
    : work.submit(prepared, attachmentLease || undefined) as Promise<T>;
}
