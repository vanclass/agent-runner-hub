import { copy, record, same, type FeatureAdmission, type FeatureResult, type FeatureSnapshot } from './runnerConfigContract';

const connectedModes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'] as const;
export type ConnectedRunMode = typeof connectedModes[number];
const isConnectedMode = (value: unknown): value is ConnectedRunMode =>
  connectedModes.some(mode => mode === value);
const familyFor = (mode: ConnectedRunMode) => mode === 'pure-direct-run' ? 'direct-run' : mode;
const unsupportedMode = 'RECOVERY_MODE_UNSUPPORTED';

export type RecoveryReference = { version: 1; family: 'direct-run'; session_id: string; generation_id: string;
  thread_id: string; resume_id: string; source_exec_run_id: string }
  | { version: 1; family: 'task-run'; repository_namespace: string; task_number: string; task_workload_id: string }
  | { version: 1; family: 'issue-run'; issue_run_id: string; created_by_runner_session_id: string; creation_provenance_digest: string };
export const recoveryOutcomes = ['recovered', 'absent', 'blocked', 'identity_conflict', 'interaction_required', 'unverified', 'partial'] as const;
export type RecoveryOutcome = typeof recoveryOutcomes[number];
export type RecoveryRecord = { reference?: RecoveryReference; runMode?: ConnectedRunMode;
  state: 'eligible' | 'attempting' | RecoveryOutcome; code?: string };
export type RecoveryCapability = { version: 1; operations: string[]; lifecycle_version?: number | null;
  connected_version?: number | null; eligibility_version?: number | null;
  connected_run_modes?: string[] | null; families?: string[] };
export type RecoveryRequest = { operation: 'recovery.reference'; api_version: 1; observation_id: string }
  | { operation: 'recovery.current'; api_version: 1 }
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
    || v.runMode !== undefined && (!isConnectedMode(v.runMode) || v.reference && familyFor(v.runMode) !== (v.reference as RecoveryReference).family)
    || ['eligible', 'attempting'].includes(String(v.state)) && !v.reference && !v.runMode
    || v.code !== undefined && (typeof v.code !== 'string' || !/^[A-Z0-9_]{0,100}$/.test(v.code))) return;
  return { state: v.state as RecoveryRecord['state'],
    ...(v.reference ? { reference: copy(v.reference as RecoveryReference) } : {}),
    ...(isConnectedMode(v.runMode) ? { runMode: v.runMode } : {}),
    ...(v.code ? { code: v.code as string } : {}) };
}
interface RecoveryTransport {
  submit(request: RecoveryRequest): Promise<FeatureAdmission>;
  completionMs: number;
  observeMs?: number;
  restoreMode?(mode: ConnectedRunMode): Promise<boolean>;
}
export class RunnerRecovery {
  saved?: RecoveryRecord;
  outcome?: RecoveryOutcome | 'waiting' | 'recovering' | 'mode-restored';
  private pending: boolean;
  private restoring = false;
  private closed = false;
  private epoch = 0;
  private snapshot?: FeatureSnapshot;
  private capturing?: Promise<void>;
  private verifiedReference?: RecoveryReference;
  private observedChange?: string;
  private nextObservation = 0;
  private protectedEmptyMode?: string;
  private historicalModes: readonly string[] = [];
  code?: string;
  history?: 'displayed' | 'incomplete' | 'unverified';
  private waiting?: { id?: number; generation: number; operation: RecoveryRequest['operation'];
    finish: (r?: FeatureResult) => void; timer: ReturnType<typeof setTimeout> };

  constructor(saved: RecoveryRecord | undefined, restore: boolean, private transport: RecoveryTransport,
    private changed: () => boolean | void) {
    this.pending = false;
    this.restore(saved, restore);
  }
  get busy() { return this.pending || this.restoring; }
  get connectedReference() {
    return same(this.verifiedReference, this.saved?.reference) ? this.verifiedReference : undefined;
  }
  restore(saved: RecoveryRecord | undefined, restore: boolean, historicalModes: readonly string[] = []) {
    this.close();
    this.closed = false;
    this.saved = saved && copy(saved);
    this.historicalModes = historicalModes;
    this.pending = restore && !!saved;
    this.outcome = this.pending ? 'waiting' : undefined;
    this.code = this.history = this.protectedEmptyMode = undefined;
    this.nextObservation = 0;
    this.observedChange = undefined;
  }
  legacy() { this.outcome = 'unverified'; this.code = 'RECOVERY_MODE_UNVERIFIED'; }
  observe(snapshot: FeatureSnapshot | undefined, ready: boolean, available: boolean, liveMode?: string,
    change?: string, interactionRequired = false) {
    this.snapshot = snapshot;
    if (this.observedChange !== change) { this.observedChange = change; this.nextObservation = 0; }
    this.settleRequest();
    if (this.closed || !ready || !snapshot || this.waiting || this.restoring) return;
    if (this.pending) {
      if (interactionRequired) {
        this.pending = false;
        this.protectedEmptyMode = liveMode ?? '';
        this.fail('interaction_required', 'RECOVERY_STARTUP_INTERACTION_REQUIRED');
        return;
      }
      if (!available) return;
      this.pending = false;
      this.restoring = true;
      this.outcome = 'recovering';
      this.protectedEmptyMode = liveMode ?? '';
      const epoch = this.epoch;
      void this.restoreConnected(snapshot, epoch).catch(() => {
        if (this.epoch === epoch) this.fail('unverified', 'RECOVERY_RECEIPT_UNVERIFIED');
      }).finally(() => {
        if (this.epoch !== epoch) return;
        if (this.outcome === 'recovering') this.fail('unverified', 'RECOVERY_OWNER_CHANGED');
        this.restoring = false;
        this.changed();
      });
      return;
    }
    if (available && this.supportsCurrent(snapshot) && performance.now() >= this.nextObservation)
      void this.refreshConnected();
  }
  private supportsCurrent(snapshot: FeatureSnapshot, mode?: ConnectedRunMode) {
    const cap = snapshot.recovery;
    return !!cap && cap.connected_version === 1 && cap.eligibility_version === 1
      && cap.operations.includes('recovery.current') && !!cap.connected_run_modes?.length
      && (!mode || cap.connected_run_modes.includes(mode));
  }
  private settleRequest() {
    const snapshot = this.snapshot, wait = this.waiting;
    if (!wait || !snapshot) return;
    if (snapshot.generation !== wait.generation) { wait.finish(); return; }
    const result = snapshot.results.find(r => r.id === wait.id && r.feature === 'recovery' && r.operation === wait.operation);
    if (result && ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(result.state)) wait.finish(result);
  }
  private async readConnected(generation: number) {
    const result = await this.request({ operation: 'recovery.current', api_version: 1 }, generation);
    const reply = this.accepted(result);
    if (reply?.connected_version !== 1 || !isConnectedMode(reply.run_mode)) return { reply };
    const runMode = reply.run_mode;
    if (reply.reference_status === 'absent' && !reply.code && reply.reference == null && reply.lifecycle == null)
      return { reply, context: { runMode, state: 'eligible' } satisfies RecoveryRecord };
    if (reply.reference_status === 'present' && isRecoveryReference(reply.reference)
      && reply.reference.family === familyFor(runMode) && record(reply.lifecycle)
      && reply.lifecycle.lifecycle_version === 1 && reply.lifecycle.authoritative === true
      && reply.lifecycle.run_mode === runMode && same(reply.lifecycle.reference, reply.reference)
      && ['eligible', 'ineligible'].includes(String(reply.lifecycle.eligibility))) {
      return { reply, context: { runMode, reference: reply.reference, state: 'eligible' } satisfies RecoveryRecord };
    }
    return { reply };
  }
  private accepted(result?: FeatureResult) {
    return result?.state === 'accepted' && result.phase === 'completed' && record(result.reply) ? result.reply : undefined;
  }
  private failureCode(reply: Record<string, unknown> | undefined, fallback: string) {
    return typeof reply?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(reply.code) ? reply.code : fallback;
  }
  private valid(epoch: number, generation: number) {
    return !this.closed && this.epoch === epoch && this.snapshot?.generation === generation;
  }
  refreshConnected(): Promise<void> {
    if (this.capturing) return this.capturing;
    const capture = this.captureConnected().finally(() => {
      if (this.capturing === capture) this.capturing = undefined;
    });
    return this.capturing = capture;
  }
  async verifyReleased() {
    const snapshot = this.snapshot;
    if (!snapshot || !this.supportsCurrent(snapshot)) return true;
    const { generation } = snapshot, epoch = this.epoch, change = this.observedChange;
    const { context } = await this.readConnected(generation);
    return this.epoch === epoch && this.snapshot?.generation === generation
      && this.observedChange === change && !!context && !('reference' in context);
  }
  private async captureConnected() {
    const snapshot = this.snapshot;
    if (this.closed || this.busy || this.waiting || !snapshot || !this.supportsCurrent(snapshot)) return;
    if (this.saved?.reference && (!this.saved.runMode || this.saved.state === 'attempting' || this.saved.state === 'partial')) return;
    const { generation } = snapshot, epoch = this.epoch;
    this.nextObservation = performance.now() + (this.transport.observeMs ?? this.transport.completionMs);
    const { context, reply } = await this.readConnected(generation);
    if (!this.valid(epoch, generation)) return;
    this.verifiedReference = context && 'reference' in context ? context.reference : undefined;
    if (!context) {
      if (!this.saved || this.protectedEmptyMode !== undefined) return;
      if (reply?.reference_status === 'unsupported' && reply.run_mode === 'subagent-run') {
        this.commit({ ...this.saved, state: 'unverified', code: unsupportedMode });
        return;
      }
      this.fail(reply?.reference_status === 'identity_conflict' ? 'identity_conflict' : 'unverified',
        this.failureCode(reply, 'RECOVERY_CURRENT_UNVERIFIED'));
    } else {
      if (!('reference' in context) && context.runMode === this.protectedEmptyMode) return;
      if (this.commit(context)) {
        this.protectedEmptyMode = undefined;
        if (this.outcome !== 'recovered' && this.outcome !== 'mode-restored') this.outcome = undefined;
        this.code = undefined;
      }
    }
    this.changed();
  }
  private commit(saved: RecoveryRecord) {
    if (same(this.saved, saved)) return true;
    const prior = this.saved;
    this.saved = saved;
    if (this.changed() !== false) return true;
    this.saved = prior;
    this.fail('unverified', 'RECOVERY_SAVE_FAILED');
    return false;
  }
  private async restoreConnected(snapshot: FeatureSnapshot, epoch: number) {
    const { generation, recovery: cap } = snapshot;
    const { runMode: savedMode, reference, state, code } = this.saved!;
    if (code === unsupportedMode) { this.outcome = undefined; return; }
    if (!savedMode && !reference) { this.legacy(); return; }
    if (!cap || !this.supportsCurrent(snapshot, savedMode)) {
      this.fail('unverified', 'RECOVERY_UNSUPPORTED');
      return;
    }
    if (!reference) { await this.restoreMode(savedMode!, generation, epoch); return; }
    if (cap.lifecycle_version !== 1 || !cap.families?.includes(reference.family)
      || !['recovery.observe', 'recovery.recover'].every(op => cap.operations.includes(op))) {
      this.fail('unverified', 'RECOVERY_FAMILY_UNSUPPORTED');
      return;
    }
    const observed = this.accepted(await this.request({ operation: 'recovery.observe', api_version: 1, reference }, generation));
    if (!this.valid(epoch, generation)) return;
    const exact = observed?.lifecycle_version === 1 && same(observed.reference, reference)
      && observed.authoritative === true && observed.ownership === 'available';
    const conclusivelyIneligible = observed?.eligibility === 'ineligible'
      && (observed.disposition === 'discarded' || reference.family !== 'direct-run' && observed.disposition === 'completed');
    if (savedMode && exact && (observed.run_mode == null || observed.run_mode === savedMode)
      && (conclusivelyIneligible || observed.disposition === 'absent')) {
      await this.restoreMode(savedMode, generation, epoch);
      return;
    }
    const runMode = observed?.run_mode;
    if (!exact || observed.eligibility !== 'eligible' || !isConnectedMode(runMode) || familyFor(runMode) !== reference.family
      || !this.supportsCurrent(snapshot, runMode) || (savedMode ? savedMode !== runMode : this.historicalModes.some(mode => mode !== runMode))
      || !(reference.family === 'direct-run' && observed.disposition === 'completed'
        || ['incomplete', 'suspended'].includes(String(observed.disposition)))) {
      this.fail(observed?.disposition === 'identity_conflict' ? 'identity_conflict' : observed?.ownership === 'in_use' ? 'blocked' : 'unverified',
        this.failureCode(observed, 'RECOVERY_ELIGIBILITY_UNVERIFIED'));
      return;
    }
    if (!savedMode && (!this.commit({ reference, runMode, state }) || !this.valid(epoch, generation))) return;
    if (state === 'attempting' || state === 'partial') {
      this.fail('partial', 'RECOVERY_PRIOR_ATTEMPT_UNCERTAIN');
      return;
    }
    await this.adopt(reference, runMode, generation, epoch);
  }
  private fail(outcome: RecoveryOutcome, code: string) {
    this.outcome = outcome;
    this.code = code;
  }
  private async adopt(reference: RecoveryReference, runMode: ConnectedRunMode, generation: number, epoch: number) {
    if (!this.commit({ reference, runMode, state: 'attempting' }) || !this.valid(epoch, generation)) return;
    const result = await this.request({ operation: 'recovery.recover', api_version: 1, reference }, generation);
    if (!this.valid(epoch, generation)) return;
    const reply = result?.phase === 'completed' && record(result.reply) && same(result.reply.reference, reference)
      ? result.reply : undefined;
    const replay = record(reply?.historical_replay) ? reply.historical_replay.status : undefined;
    if (replay === 'displayed' || replay === 'incomplete') this.history = replay;
    const outcome = reply?.recovery_status as RecoveryOutcome;
    if (outcome !== 'recovered' || result?.state !== 'accepted' || reply?.outcome_unknown !== false || reply.run_mode !== runMode) {
      if (reply?.outcome_unknown === false && outcome !== 'recovered'
        && !this.commit({ reference, runMode, state: 'eligible' })) return;
      this.fail(reply?.outcome_unknown === false && recoveryOutcomes.includes(outcome) && outcome !== 'recovered' ? outcome : 'partial',
        this.failureCode(reply, result?.code || 'RECOVERY_RECEIPT_UNVERIFIED'));
      return;
    }
    this.history ??= 'unverified';
    const { context } = await this.readConnected(generation);
    if (!this.valid(epoch, generation)) return;
    if (context?.runMode !== runMode || !('reference' in context)) {
      this.fail('partial', 'RECOVERY_CONNECTED_CONTEXT_UNVERIFIED');
      return;
    }
    if (this.commit(context)) {
      this.outcome = 'recovered';
      this.verifiedReference = context.reference;
      this.protectedEmptyMode = undefined;
    }
  }
  discard() { this.close(); this.saved = undefined; this.outcome = this.code = this.history = undefined; }
  private async restoreMode(runMode: ConnectedRunMode, generation: number, epoch: number) {
    if (!await this.transport.restoreMode?.(runMode)) {
      if (this.valid(epoch, generation)) this.fail('unverified', 'RECOVERY_MODE_RESTORE_FAILED');
      return;
    }
    if (!this.valid(epoch, generation)) return;
    const { context } = await this.readConnected(generation);
    if (!this.valid(epoch, generation)) return;
    if (context?.runMode !== runMode || 'reference' in context) {
      this.fail('unverified', 'RECOVERY_MODE_UNVERIFIED');
      return;
    }
    if (this.commit(context)) {
      this.outcome = 'mode-restored';
      this.protectedEmptyMode = undefined;
    }
  }
  close() {
    if (this.busy) this.fail(this.restoring ? 'partial' : 'unverified', 'RECOVERY_CONNECTION_ENDED');
    this.epoch++;
    this.closed = true;
    this.verifiedReference = undefined;
    this.capturing = undefined;
    this.pending = this.restoring = false;
    this.waiting?.finish();
  }
  private request(request: RecoveryRequest, generation: number): Promise<FeatureResult | undefined> {
    return new Promise(resolve => {
      const finish = (result?: FeatureResult) => {
        if (this.waiting?.finish !== finish) return;
        clearTimeout(this.waiting.timer); this.waiting = undefined; resolve(result);
      };
      this.waiting = { generation, operation: request.operation, finish,
        timer: setTimeout(() => finish(), this.transport.completionMs) };
      void this.transport.submit(request).then(admission => {
        if (this.waiting?.finish !== finish) return;
        if (admission.state !== 'submitted' || admission.generation !== generation) finish();
        else { this.waiting.id = admission.id; this.settleRequest(); }
      }, () => finish());
    });
  }
}
