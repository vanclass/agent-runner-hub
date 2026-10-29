import { isDigest, record } from './runnerConfigContract';

export type RunCapability = { version: 1; operations: string[] };
export type RunRequest = { operation: 'run.invoke'; api_version: 1 }
  | { operation: 'run.status'; api_version: 1; invocation_request_id: number };
export type RunObservation = {
  invocation_request_id: number; request_status: 'accepted';
  initiation_status: 'pending' | 'started' | 'not_started' | 'unknown';
  dispatch_status: 'dispatching' | 'returned' | 'unknown';
  issue_run_id: string; authority_digest: string; state_revision: number;
  lifecycle_status: string; lifecycle_terminal: boolean; terminal_reason: string;
  outcome: string; owner_status: string; outcome_unknown: boolean;
  user_input_required?: boolean; code?: string;
};
export function supportsRun(cap?: RunCapability | null) {
  return cap?.version === 1 && ['run.invoke', 'run.status'].every(op => cap.operations.includes(op));
}
export function isRunObservation(v: unknown, original: number): v is RunObservation {
  if (!record(v) || v.invocation_request_id !== original || !Number.isSafeInteger(original) || original < 1
    || v.request_status !== 'accepted' || !['dispatching', 'returned', 'unknown'].includes(String(v.dispatch_status))
    || typeof v.outcome_unknown !== 'boolean' || typeof v.lifecycle_terminal !== 'boolean'
    || !['issue_run_id', 'authority_digest', 'lifecycle_status', 'terminal_reason', 'outcome', 'owner_status'].every(k => typeof v[k] === 'string')
    || v.user_input_required !== undefined && typeof v.user_input_required !== 'boolean'
    || v.code !== undefined && typeof v.code !== 'string') return false;
  if (v.initiation_status === 'started') return !!v.issue_run_id && String(v.issue_run_id).length <= 256
    && !/[\x00-\x1f\x7f]/.test(String(v.issue_run_id)) && isDigest(v.authority_digest)
    && Number.isSafeInteger(v.state_revision) && Number(v.state_revision) > 0 && !!v.lifecycle_status;
  return v.issue_run_id === '' && v.authority_digest === '' && v.state_revision === 0
    && v.lifecycle_status === '' && !v.lifecycle_terminal && (v.initiation_status === 'pending'
      ? v.dispatch_status === 'dispatching' && !v.outcome_unknown : v.initiation_status === 'not_started'
        ? v.dispatch_status === 'returned' && !v.outcome_unknown : v.initiation_status === 'unknown' && v.outcome_unknown);
}
