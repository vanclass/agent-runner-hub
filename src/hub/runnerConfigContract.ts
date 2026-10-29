import type { RunnerObservation } from './runnerControl';
import type { WorkCapability, WorkRequest } from './runnerWork';

export type ConfigAccount = { agent_id: string; profile_name: string };
export type ConfigModel = { id: string; reasoning_effort: string };
export type ConfigSettings = { target: string; account: ConfigAccount; model: ConfigModel;
  service_tier: string; run_mode: string; root: string };
export type ConfigDesired = Partial<ConfigSettings>;
export type ConfigTarget = { id: string; owner: string; project: string };
export type ConfigModelOption = { id: string; reasoning_efforts: string[]; service_tiers: string[] };
export type ConfigOptions = { targets: ConfigTarget[]; accounts: ConfigAccount[]; models: ConfigModelOption[]; run_modes: string[] };
export type ConfigCapability = { version: 1; operations: string[]; options_page_size: number; options_revision: boolean };
export type ConfigInspect = { api_version: 1; revision: string; options_revision?: string | null;
  current: ConfigSettings; effective: RunnerObservation['selection']; runner_kind: string; setup_required: boolean;
  availability: Record<string, boolean>; constraints: string[]; root_requirements: Record<string, string>;
  model_catalog_status: string; model_options_account: ConfigAccount; options: ConfigOptions;
  options_page: { offset: number; totals: Record<'targets' | 'accounts' | 'models', number>; next_offset: number | null } };
export type ConfigPlan = { api_version: 1; revision: string; desired: ConfigDesired;
  changes: Partial<Record<keyof ConfigSettings, { from: unknown; to: unknown }>>; steps: ConfigStep[];
  atomic: false; errors: string[]; required_confirmations: string[]; impact: Record<string, string>;
  plan_status: 'ready' | 'invalid' | 'confirmation_required'; plan_id?: string | null };
export type ConfigStep = 'account' | 'model' | 'service_tier' | 'run_mode' | 'target';
export type ConfigReceipt = { setting: ConfigStep; outcome: 'success' | 'rejected' | 'cancelled' | 'failed' | 'unknown' | 'not_attempted';
  committed?: ConfigDesired | null; owner_status?: string | null; code?: string | null; codes?: string[] | null };
export type ConfigApply = { api_version: 1; apply_status: 'applied' | 'partial' | 'rejected' | 'cancelled' | 'failed' | 'unknown';
  atomic: false; results: ConfigReceipt[]; outcome_unknown: boolean; inspection_unavailable?: boolean | null;
  current?: ConfigSettings | null; revision?: string | null; code?: string | null; plan?: ConfigPlan | null };
export type ConfigRequest = { operation: 'session_config.inspect'; api_version: 1; account?: ConfigAccount; offset: number; options_revision?: string }
  | { operation: 'session_config.plan'; api_version: 1; desired: ConfigDesired }
  | { operation: 'session_config.apply'; api_version: 1; desired: ConfigDesired; revision: string; plan_id: string };
export type FeatureResult = { id: number; feature: 'session_config' | 'work' | 'brief'; operation: ConfigRequest['operation'] | WorkRequest['operation'] | 'brief.stage';
  state: 'sending' | 'queued' | 'pending-interaction' | 'accepted' | 'rejected' | 'failure' | 'outcome-unknown' | 'not-sent';
  admission: 'unconfirmed' | 'queued' | 'rejected' | 'not-sent'; phase?: string | null; code?: string | null;
  reply?: unknown };
export type FeatureSnapshot = { generation: number; sessionConfig?: ConfigCapability | null; work?: WorkCapability | null;
  brief?: { version: 1; operations: string[] } | null; results: FeatureResult[] };
export type FeatureAdmission = { state: 'submitted'; id: number; generation: number }
  | { state: 'not-sent' | 'outcome-unknown'; detail: string };
export type ConfigIdentity = { session: string; generation: number };
export type ConfigCatalog = { identity: ConfigIdentity; account?: ConfigAccount; inspection: ConfigInspect; options: ConfigOptions };

export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a).sort(), right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, i) => key === right[i]
    && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};
export const copy = <T,>(value: T): T => structuredClone(value);
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === 'string' && !!item);
export const isDigest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export function isAccount(v: unknown): v is ConfigAccount {
  return record(v) && typeof v.agent_id === 'string' && typeof v.profile_name === 'string';
}
function isSettings(v: unknown): v is ConfigSettings {
  return record(v) && ['target', 'service_tier', 'run_mode', 'root'].every(k => typeof v[k] === 'string')
    && isAccount(v.account) && record(v.model) && typeof v.model.id === 'string' && typeof v.model.reasoning_effort === 'string';
}
export function isInspection(v: unknown): v is ConfigInspect {
  if (!record(v) || v.api_version !== 1 || !isDigest(v.revision) || !isSettings(v.current)
    || !isAccount(v.model_options_account) || !record(v.options) || !record(v.options_page)
    || !record(v.availability) || !strings(v.constraints) || !record(v.root_requirements)
    || !record(v.effective) || typeof v.runner_kind !== 'string' || typeof v.setup_required !== 'boolean'
    || typeof v.model_catalog_status !== 'string') return false;
  const o = v.options, p = v.options_page;
  return Array.isArray(o.targets) && o.targets.every(x => record(x) && typeof x.id === 'string'
    && typeof x.owner === 'string' && typeof x.project === 'string')
    && Array.isArray(o.accounts) && o.accounts.every(isAccount) && Array.isArray(o.models)
    && o.models.every(x => record(x) && typeof x.id === 'string' && strings(x.reasoning_efforts) && strings(x.service_tiers))
    && strings(o.run_modes) && Number.isSafeInteger(p.offset) && record(p.totals)
    && ['targets', 'accounts', 'models'].every(k => Number.isSafeInteger((p.totals as Record<string, unknown>)[k])
      && Number((p.totals as Record<string, unknown>)[k]) >= 0)
    && (p.next_offset === null || Number.isSafeInteger(p.next_offset));
}
const steps = ['account', 'model', 'service_tier', 'run_mode', 'target'];
export function isPlan(v: unknown): v is ConfigPlan {
  return record(v) && v.api_version === 1 && isDigest(v.revision) && record(v.desired) && record(v.changes)
    && v.atomic === false && Array.isArray(v.steps) && v.steps.every(s => steps.includes(s))
    && new Set(v.steps).size === v.steps.length && strings(v.errors) && strings(v.required_confirmations)
    && record(v.impact) && ['ready', 'invalid', 'confirmation_required'].includes(String(v.plan_status))
    && (v.plan_status !== 'ready' || isDigest(v.plan_id));
}
export function isApply(v: unknown, plan: ConfigPlan, current: ConfigSettings): v is ConfigApply {
  if (!record(v) || v.api_version !== 1 || v.atomic !== false || !Array.isArray(v.results)
    || typeof v.outcome_unknown !== 'boolean' || !['applied', 'partial', 'rejected', 'cancelled', 'failed', 'unknown'].includes(String(v.apply_status))) return false;
  const results = v.results;
  const successCount = results.filter(r => record(r) && r.outcome === 'success').length;
  const unknown = results.some(r => record(r) && r.outcome === 'unknown');
  const firstStop = results.findIndex(r => !record(r) || r.outcome !== 'success');
  if (unknown !== v.outcome_unknown || (results.length && v.apply_status !== (unknown ? 'unknown'
    : successCount === results.length ? 'applied' : successCount ? 'partial' : results[0]?.outcome))) return false;
  if (firstStop >= 0 && results.slice(firstStop + 1).some(r => !record(r) || r.outcome !== 'not_attempted')) return false;
  if (results.length === 0) return (v.apply_status === 'applied' && plan.steps.length === 0)
    || v.apply_status === 'rejected';
  return results.length === plan.steps.length && results.every((r, index) => record(r) && r.setting === plan.steps[index]
    && ['success', 'rejected', 'cancelled', 'failed', 'unknown', 'not_attempted'].includes(String(r.outcome))
    && (r.outcome !== 'success' || (['SUCCESS', 'UNCHANGED'].includes(String(r.owner_status)) && record(r.committed)
      && (r.setting === 'run_mode' ? ['run_mode', 'root'] : [String(r.setting)]).every(key => {
        const desired = { ...current, ...plan.desired } as Record<string, unknown>;
        return key in (r.committed as Record<string, unknown>) && same((r.committed as Record<string, unknown>)[key], desired[key]);
      }))));
}

export function validatePage(page: ConfigInspect, first: ConfigInspect, offset: number, size: number, guarded: boolean) {
  if (page.options_page.offset !== offset || !same(page.model_options_account, first.model_options_account)
    || page.revision !== first.revision || !same(page.options_page.totals, first.options_page.totals)
    || !same(page.options.run_modes, first.options.run_modes) || page.model_catalog_status !== 'available'
    || (guarded && (!isDigest(page.options_revision) || page.options_revision !== first.options_revision))) return false;
  const lists = ['targets', 'accounts', 'models'] as const;
  if (lists.some(k => page.options[k].length !== Math.min(size, Math.max(0, first.options_page.totals[k] - offset)))) return false;
  const expected = lists.some(k => first.options_page.totals[k] > offset + size) ? offset + size : null;
  return page.options_page.next_offset === expected;
}
export function uniqueOptions(options: ConfigOptions) {
  return new Set(options.targets.map(t => t.id)).size === options.targets.length
    && new Set(options.accounts.map(a => JSON.stringify([a.agent_id, a.profile_name]))).size === options.accounts.length
    && new Set(options.models.map(m => m.id)).size === options.models.length
    && new Set(options.run_modes).size === options.run_modes.length;
}
export function validDesired(desired: ConfigDesired, current: ConfigSettings, catalog: ConfigCatalog) {
  const final = { ...current, ...desired }, { options } = catalog;
  if (desired.target !== undefined && !options.targets.some(t => t.id === final.target)) return false;
  if (desired.run_mode !== undefined && !options.run_modes.includes(final.run_mode)) return false;
  if (desired.root !== undefined && (!final.root || !['direct-run', 'pure-direct-run'].includes(final.run_mode))) return false;
  if (desired.account || desired.model || desired.service_tier) {
    const model = options.models.find(m => m.id === final.model.id);
    return same(final.account, catalog.inspection.model_options_account) && options.accounts.some(a => same(a, final.account))
      && !!model && model.reasoning_efforts.includes(final.model.reasoning_effort) && model.service_tiers.includes(final.service_tier);
  }
  return true;
}
