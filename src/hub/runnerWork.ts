import { HubError, msg } from './i18n';
import { copy, record, same, type ConfigIdentity, type FeatureAdmission, type FeatureResult, type FeatureSnapshot } from './runnerConfigContract';

export const runModes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'] as const;
export type WorkRequest = { operation: 'work.submit'; api_version: 1; instruction: string }
  | { operation: 'work.status'; api_version: 1; submission_request_id: number };
export type WorkCapability = { version: 1; operations: string[]; run_modes: string[] };
export type WorkObservation = {
  submission_request_id: number; run_mode: string;
  state: 'dispatching' | 'instruction_admitted' | 'execution_started' | 'active' | 'suspended' | 'incomplete'
    | 'succeeded' | 'failed' | 'interrupted' | 'unknown' | 'rejected';
  admission: 'pending' | 'admitted' | 'rejected' | 'unknown';
  work_id: { kind: string; id: string } | null; execution_id: string;
  event_id: number; started_event_id: number; terminal: boolean;
  outcome: 'pending' | 'succeeded' | 'failed' | 'interrupted' | 'incomplete' | 'unknown' | 'rejected';
  code: string; owner: string; owner_revision: number;
};
export type WorkAttempt = { identity: ConfigIdentity; submissionId?: number; submission?: FeatureResult;
  status?: FeatureResult; work?: WorkObservation; uncertain: boolean; notSent: boolean };
export interface WorkTransport {
  identity(): ConfigIdentity | undefined;
  available(): boolean;
  submit(session: string, request: WorkRequest): Promise<FeatureAdmission>;
}
const settled = (r: FeatureResult) => ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(r.state);
export function isWork(value: unknown, original: number): value is WorkObservation {
  if (!record(value) || value.submission_request_id !== original || !Number.isSafeInteger(value.event_id)
    || Number(value.event_id) < 1 || !Number.isSafeInteger(value.started_event_id) || Number(value.started_event_id) < 0
    || Number(value.started_event_id) > Number(value.event_id) || !Number.isSafeInteger(value.owner_revision)
    || Number(value.owner_revision) < 0 || !runModes.includes(value.run_mode as typeof runModes[number])) return false;
  return ['dispatching', 'instruction_admitted', 'execution_started', 'active', 'suspended', 'incomplete', 'succeeded',
    'failed', 'interrupted', 'unknown', 'rejected'].includes(String(value.state))
    && ['pending', 'admitted', 'rejected', 'unknown'].includes(String(value.admission))
    && ['pending', 'succeeded', 'failed', 'interrupted', 'incomplete', 'unknown', 'rejected'].includes(String(value.outcome))
    && typeof value.terminal === 'boolean' && ['code', 'owner', 'execution_id'].every(k => typeof value[k] === 'string')
    && (value.work_id === null || record(value.work_id) && ['direct_turn', 'task', 'issue'].includes(String(value.work_id.kind))
      && typeof value.work_id.id === 'string' && !!value.work_id.id)
    && (!value.started_event_id || value.admission === 'admitted') && (!value.terminal || value.outcome !== 'pending');
}

/** Composed once per owning Runner. No work identity or uncertain delivery enters storage. */
export class RunnerWork {
  readonly attempts: WorkAttempt[] = [];
  capability?: WorkCapability;
  progress?: FeatureResult;
  private snapshot?: FeatureSnapshot;
  private identity?: ConfigIdentity;
  private closed = false;
  private waiting?: { id?: number; request: WorkRequest; finish: (result: FeatureResult) => void;
    timer: ReturnType<typeof setTimeout> };
  private readonly originals = new Map<number, number>();
  private readonly seen = new Map<number, FeatureResult>();
  constructor(private readonly transport: WorkTransport, private readonly changed: () => void) {}
  get current() { return this.attempts.at(-1); }
  get busy() { return !!this.waiting; }
  get blocked() {
    const a = this.current;
    return !!a && !a.notSent && (a.uncertain || !a.work?.terminal || a.work.outcome === 'unknown');
  }
  get supported() {
    return !this.closed && this.capability?.version === 1
      && ['work.submit', 'work.status'].every(op => this.capability?.operations.includes(op))
      && runModes.every(mode => this.capability?.run_modes.includes(mode));
  }
  observe(session: string, state: string, snapshot?: FeatureSnapshot) {
    if (this.closed) return;
    const identity = state === 'ready' && snapshot && snapshot.generation > 0
      ? { session, generation: snapshot.generation } : undefined;
    if (this.identity && identity && !same(this.identity, identity)) { this.close(); return; }
    if (identity) this.identity = identity;
    this.snapshot = snapshot;
    this.capability = state === 'ready' ? snapshot?.work ?? undefined : undefined;
    for (const result of snapshot?.results ?? []) this.consume(result);
    const wait = this.waiting;
    const receipt = snapshot?.results.find(r => r.id === wait?.id && r.feature === 'work' && r.operation === wait?.request.operation);
    if (receipt) { this.progress = copy(receipt); if (settled(receipt)) wait?.finish(copy(receipt)); }
    if (state === 'disconnected') this.close();
  }
  private consume(result: FeatureResult) {
    if (result.feature !== 'work' || !settled(result)) return;
    const original = result.operation === 'work.submit' ? result.id : this.originals.get(result.id);
    const attempt = this.attempts.find(a => a.submissionId === original && same(a.identity, this.identity));
    if (!attempt) return;
    if (same(this.seen.get(result.id), result)) return;
    this.seen.set(result.id, copy(result));
    if (result.operation === 'work.submit') attempt.submission = copy(result);
    else attempt.status = copy(result);
    if (result.operation === 'work.submit' && (result.state === 'not-sent' || result.admission === 'rejected')) {
      attempt.notSent = true; attempt.uncertain = false; return;
    }
    const reply = result.reply;
    if (result.phase !== 'completed' || !record(reply) || !isWork(reply.work, original!)) {
      attempt.uncertain = true; return;
    }
    const work = reply.work, previous = attempt.work;
    if (result.operation === 'work.submit' && result.state === 'accepted' && reply.receipt !== 'dispatch_received'
      || previous && (work.event_id < previous.event_id || work.started_event_id < previous.started_event_id
        || previous.started_event_id > 0 && work.started_event_id !== previous.started_event_id
        || previous.admission === 'admitted' && work.admission !== 'admitted'
        || work.owner_revision < previous.owner_revision
        || previous.work_id && !same(previous.work_id, work.work_id)
        || work.event_id === previous.event_id && !same(work, previous))) {
      attempt.uncertain = true; return;
    }
    attempt.work = copy(work);
    attempt.uncertain = work.outcome === 'unknown' || work.admission === 'unknown';
    this.changed();
  }
  private request(request: WorkRequest): Promise<FeatureResult> {
    const identity = this.transport.identity();
    if (!this.supported || !identity || !same(identity, this.identity) || !this.transport.available() || this.waiting)
      throw new HubError(msg('work.unavailable'));
    return new Promise(resolve => {
      const unknown = (id = this.waiting?.id ?? 0): FeatureResult => ({ id, feature: 'work', operation: request.operation,
        state: 'outcome-unknown', admission: 'unconfirmed', code: 'WORK_RECEIPT_UNAVAILABLE' });
      const finish = (result: FeatureResult) => {
        if (this.waiting?.finish !== finish) return;
        clearTimeout(this.waiting.timer);
        this.waiting = undefined;
        this.progress = result;
        this.consume(result);
        this.changed();
        resolve(result);
      };
      this.waiting = { request, finish, timer: setTimeout(() => finish(unknown()), 90000) };
      this.progress = { ...unknown(), state: 'sending' };
      this.changed();
      void this.transport.submit(identity.session, request).then(admission => {
        if (this.waiting?.finish !== finish) return;
        if (admission.state !== 'submitted') {
          finish({ ...unknown(), state: admission.state, admission: admission.state === 'not-sent' ? 'not-sent' : 'unconfirmed', code: admission.detail });
          return;
        }
        if (request.operation === 'work.submit') {
          this.current!.submissionId = admission.id;
          this.current!.notSent = false;
        } else this.originals.set(admission.id, request.submission_request_id);
        this.waiting.id = admission.id;
        if (!same(identity, this.transport.identity()) || admission.generation !== identity.generation) {
          finish(unknown(admission.id)); return;
        }
        // A snapshot can arrive before the native admission promise resolves.
        this.observe(identity.session, 'ready', this.snapshot);
      }, () => finish(unknown()));
    });
  }
  async submit(instruction: string) {
    if (this.blocked || this.busy || !instruction.trim() || instruction.includes('\0') || instruction.trimStart().startsWith('/'))
      throw new HubError(msg('work.unavailable'));
    const identity = this.transport.identity();
    if (!identity || !this.supported) throw new HubError(msg('work.unavailable'));
    const attempt: WorkAttempt = { identity: copy(identity), uncertain: false, notSent: true };
    this.attempts.push(attempt);
    try {
      const result = await this.request({ operation: 'work.submit', api_version: 1, instruction });
      attempt.submission = copy(result);
      if (result.state === 'not-sent' || result.admission === 'rejected') { attempt.notSent = true; return attempt; }
      attempt.notSent = false;
      if (!attempt.submissionId || !attempt.work) { attempt.uncertain = true; return attempt; }
      const deadline = performance.now() + 90000;
      while (!this.closed && !attempt.uncertain && !attempt.work.started_event_id && !attempt.work.terminal
        && !['suspended', 'incomplete', 'failed', 'unknown'].includes(attempt.work.state) && performance.now() < deadline) {
        await this.refreshStatus();
        if (!attempt.work.started_event_id && !attempt.work.terminal) await new Promise(resolve => setTimeout(resolve, 500));
      }
      return attempt;
    } catch (reason) {
      if (attempt.submissionId || !attempt.notSent) attempt.uncertain = true;
      throw reason;
    }
  }
  async refreshStatus() {
    const attempt = this.current;
    if (!attempt?.submissionId || this.busy || this.closed) return;
    await this.request({ operation: 'work.status', api_version: 1, submission_request_id: attempt.submissionId });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.capability = undefined;
    const wait = this.waiting;
    if (wait) wait.finish({ id: wait.id ?? 0, feature: 'work', operation: wait.request.operation,
      state: 'outcome-unknown', admission: 'unconfirmed', code: 'WORK_SESSION_EXITED' });
    if (this.current && !this.current.notSent && !this.current.work?.terminal) this.current.uncertain = true;
    this.changed();
  }
}
