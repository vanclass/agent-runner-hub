import { copy, record, same, type FeatureAdmission, type FeatureResult, type FeatureSnapshot } from './runnerConfigContract';
import type { WorkAttempt } from './runnerWork';

export type RecoveryReference = { version: 1; family: 'direct-run'; session_id: string; generation_id: string;
  thread_id: string; resume_id: string; source_exec_run_id: string }
  | { version: 1; family: 'task-run'; repository_namespace: string; task_number: string; task_workload_id: string }
  | { version: 1; family: 'issue-run'; issue_run_id: string; created_by_runner_session_id: string; creation_provenance_digest: string };
export const recoveryOutcomes = ['recovered', 'absent', 'blocked', 'identity_conflict', 'interaction_required', 'unverified', 'partial'] as const;
export type RecoveryOutcome = typeof recoveryOutcomes[number];
export type RecoveryRecord = { reference?: RecoveryReference; state: 'eligible' | 'attempting' | RecoveryOutcome; code?: string };
export type RecoveryRequest = { operation: 'recovery.reference'; api_version: 1; observation_id: string }
  | { operation: 'recovery.recover' | 'recovery.observe'; api_version: 1; reference: RecoveryReference };
const fields = {
  'direct-run': ['session_id', 'generation_id', 'thread_id', 'resume_id', 'source_exec_run_id'],
  'task-run': ['repository_namespace', 'task_number', 'task_workload_id'],
  'issue-run': ['issue_run_id', 'created_by_runner_session_id', 'creation_provenance_digest'],
};
export function isRecoveryReference(v: unknown): v is RecoveryReference {
  if (!record(v) || v.version !== 1 || !Object.hasOwn(fields, String(v.family))) return false;
  const keys = fields[v.family as keyof typeof fields];
  return Object.keys(v).length === keys.length + 2 && keys.every(key => {
    const s = v[key];
    if (['thread_id', 'resume_id'].includes(key) && s === '') return true;
    return typeof s === 'string' && /^[a-z0-9][a-z0-9_.-]{0,254}$/i.test(s) && !s.endsWith('.')
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s);
  }) && (v.family !== 'direct-run' || !!v.thread_id || !!v.resume_id);
}
export function recoveryRecord(v: unknown): RecoveryRecord | undefined {
  if (!record(v) || !['eligible', 'attempting', ...recoveryOutcomes].includes(String(v.state))
    || v.reference !== undefined && !isRecoveryReference(v.reference)
    || ['eligible', 'attempting'].includes(String(v.state)) && !v.reference
    || v.code !== undefined && (typeof v.code !== 'string' || !/^[A-Z0-9_]{0,100}$/.test(v.code))) return;
  return { state: v.state as RecoveryRecord['state'],
    ...(v.reference ? { reference: copy(v.reference as RecoveryReference) } : {}),
    ...(v.code ? { code: v.code as string } : {}) };
}
interface RecoveryTransport {
  submit(request: RecoveryRequest): Promise<FeatureAdmission>;
  completionMs: number;
  observeMs?: number;
}
export class RunnerRecovery {
  saved?: RecoveryRecord;
  outcome?: RecoveryOutcome | 'waiting' | 'recovering';
  private pending: boolean;
  private capturing?: WorkAttempt;
  private latest?: WorkAttempt;
  private referenced?: WorkAttempt;
  private closed = false;
  private epoch = 0;
  private generation?: number;
  private nextObservation = 0;
  private lifecycle = false;
  private waiting?: { id?: number; generation: number; operation: RecoveryRequest['operation']; blocking: boolean;
    finish: (r?: FeatureResult) => void; timer: ReturnType<typeof setTimeout> };
  constructor(saved: RecoveryRecord | undefined, restore: boolean, private transport: RecoveryTransport,
    private changed: () => boolean | void) {
    this.saved = saved && copy(saved);
    if (this.saved?.state === 'attempting') this.saved.state = 'partial';
    this.pending = restore && this.saved?.state === 'eligible';
    if (restore) this.outcome = this.pending ? 'waiting' : this.saved?.state === 'eligible' ? undefined : this.saved?.state;
  }
  get busy() { return !!this.waiting?.blocking || this.pending; }
  restore(saved: RecoveryRecord | undefined, restore: boolean) {
    this.epoch++; this.waiting?.finish(); this.nextObservation = 0; this.lifecycle = false;
    this.closed = false;
    this.latest = this.capturing = this.referenced = undefined;
    this.saved = saved && copy(saved);
    if (this.saved?.state === 'attempting') this.saved.state = 'partial';
    this.pending = restore && this.saved?.state === 'eligible';
    this.outcome = restore ? this.pending ? 'waiting' : this.saved?.state === 'eligible' ? undefined : this.saved?.state : undefined;
  }
  private set(saved: RecoveryRecord | undefined) { this.saved = saved; return this.changed(); }
  observe(snapshot: FeatureSnapshot | undefined, ready: boolean, available: boolean, attempts: readonly WorkAttempt[]) {
    this.generation = snapshot?.generation;
    this.lifecycle ||= !!snapshot && this.supportsLifecycle(snapshot);
    const wait = this.waiting;
    if (wait && snapshot) {
      const result = snapshot.results.find(r => r.id === wait.id && r.feature === 'recovery' && r.operation === wait.operation);
      if (snapshot.generation !== wait.generation) { wait.finish(); return; }
      else if (result && ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(result.state)) { wait.finish(result); return; }
    }
    if (this.closed || !ready || !snapshot || this.waiting) return;
    if (this.pending) {
      if (!available) return;
      this.pending = false;
      if (!snapshot.recovery) { this.outcome = 'unverified'; this.set({ ...this.saved, state: 'unverified', code: 'RECOVERY_UNSUPPORTED' }); return; }
      this.outcome = 'recovering';
      const reference = this.saved!.reference!;
      const epoch = this.epoch;
      const generation = snapshot.generation;
      const recover = async () => {
        if (this.supportsLifecycle(snapshot)) {
          const terminal = await this.observeReference(reference, generation, true);
          if (terminal || !this.current(reference, generation, epoch)) return;
        }
        if (this.set({ reference, state: 'attempting' }) === false) {
          this.outcome = 'unverified'; this.set({ reference, state: 'unverified', code: 'RECOVERY_SAVE_FAILED' }); return;
        }
        const result = await this.request({ operation: 'recovery.recover', api_version: 1, reference }, generation);
        if (!this.current(reference, generation, epoch)) return;
        const reply = result?.reply;
        const valid = result?.phase === 'completed' && record(reply) && same(reply.reference, reference)
          && recoveryOutcomes.includes(reply.recovery_status as RecoveryOutcome);
        const outcome = valid ? reply.recovery_status as RecoveryOutcome : 'partial';
        this.outcome = outcome === 'recovered' && (result?.state !== 'accepted' || !record(reply)
          || reply.outcome_unknown !== false) ? 'partial' : outcome;
        this.set({ reference, state: this.outcome === 'recovered' ? 'eligible' : this.outcome,
          ...(valid && typeof reply.code === 'string' && /^[A-Z0-9_]{0,100}$/.test(reply.code) ? { code: reply.code } : {}) });
      };
      void recover();
      return;
    }
    this.retireCompleted(attempts);
    if (this.saved) {
      if (available && this.saved.reference && this.supportsLifecycle(snapshot) && performance.now() >= this.nextObservation)
        void this.observeReference(this.saved.reference, snapshot.generation);
      return;
    }
    const latest = attempts.reduce<WorkAttempt | undefined>((a, b) =>
      (b.work?.started_event_id ?? 0) > (a?.work?.started_event_id ?? 0) ? b : a, undefined);
    if (this.latest && !attempts.includes(this.latest)) {
      return;
    }
    if (!latest?.work) return;
    if (latest !== this.latest) {
      this.latest = latest; this.capturing = undefined; this.outcome = undefined; this.set(undefined);
    }
    if (latest.work.terminal && !['incomplete', 'unknown'].includes(latest.work.outcome)) {
      this.outcome = undefined;
      if (this.saved) this.set(undefined);
      return;
    }
    if (this.capturing === latest || !available) return;
    this.capturing = latest;
    this.set({ state: 'unverified', code: 'RECOVERY_REFERENCE_PENDING' });
    if (!snapshot.recovery) { this.outcome = 'unverified'; this.set({ state: 'unverified', code: 'RECOVERY_UNSUPPORTED' }); return; }
    const observation_id = latest.work.observation_id;
    const epoch = this.epoch;
    const generation = snapshot.generation;
    void this.request({ operation: 'recovery.reference', api_version: 1, observation_id }, generation).then(result => {
      if (this.closed || this.latest !== latest || this.epoch !== epoch || this.generation !== generation) return;
      const reply = result?.reply;
      if (result?.state === 'accepted' && result.phase === 'completed' && record(reply)
        && reply.observation_id === observation_id && isRecoveryReference(reply.reference)) {
        this.referenced = latest;
        this.set({ reference: reply.reference, state: 'eligible' });
      } else { this.outcome = 'unverified'; this.set({ state: 'unverified', code: 'RECOVERY_REFERENCE_UNVERIFIED' }); }
    });
  }
  legacy() { if (!this.saved) this.outcome = 'unverified'; }
  private supportsLifecycle(snapshot: FeatureSnapshot) {
    return snapshot.recovery?.lifecycle_version === 1 && snapshot.recovery.operations.includes('recovery.observe');
  }
  private current(reference: RecoveryReference, generation: number, epoch: number) {
    return !this.closed && this.epoch === epoch && this.generation === generation && same(this.saved?.reference, reference);
  }
  private async observeReference(reference: RecoveryReference, generation: number, blocking = false) {
    const epoch = this.epoch;
    const result = await this.request({ operation: 'recovery.observe', api_version: 1, reference }, generation, blocking);
    if (!this.current(reference, generation, epoch)) return false;
    this.nextObservation = performance.now() + (this.transport.observeMs ?? this.transport.completionMs);
    const reply = result?.reply;
    if (result?.state !== 'accepted' || result.phase !== 'completed' || !record(reply)
      || !isRecoveryReference(reply.reference) || !same(reply.reference, reference) || reply.lifecycle_version !== 1
      || reply.authoritative !== true || reply.terminal !== true || reply.ownership !== 'available'
      || !['completed', 'discarded'].includes(String(reply.disposition))) return false;
    const retained = this.saved;
    if (this.set(undefined) === false) { this.saved = retained; this.outcome = 'unverified'; }
    else { this.referenced = undefined; this.outcome = undefined; }
    return true;
  }
  retireCompleted(attempts: readonly WorkAttempt[]) {
    if (this.lifecycle) return;
    const work = this.referenced?.work;
    if (!this.saved?.reference || !this.referenced || !attempts.includes(this.referenced)
      || !work?.terminal || ['incomplete', 'unknown'].includes(work.outcome)) return;
    const retained = this.saved;
    if (this.set(undefined) === false) this.saved = retained;
    else { this.referenced = undefined; this.outcome = undefined; }
  }
  discard() { this.close(); this.saved = undefined; this.outcome = undefined; }
  close() {
    this.epoch++;
    this.closed = true;
    if (this.saved?.state === 'attempting') {
      this.saved = { ...this.saved, state: 'partial' }; this.outcome = 'partial';
    } else if (this.pending) this.outcome = 'unverified';
    this.pending = false; this.waiting?.finish();
  }
  private request(request: RecoveryRequest, generation: number, blocking = true): Promise<FeatureResult | undefined> {
    return new Promise(resolve => {
      const finish = (result?: FeatureResult) => {
        if (this.waiting?.finish !== finish) return;
        clearTimeout(this.waiting.timer); this.waiting = undefined; resolve(result);
      };
      this.waiting = { generation, operation: request.operation, blocking, finish,
        timer: setTimeout(() => finish(), this.transport.completionMs) };
      void this.transport.submit(request).then(admission => {
        if (this.waiting?.finish !== finish) return;
        if (admission.state !== 'submitted' || admission.generation !== generation) finish();
        else this.waiting.id = admission.id;
      }, () => finish());
    });
  }
}
