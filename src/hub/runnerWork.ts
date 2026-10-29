import { HubError, msg } from './i18n';
import { copy, record, same, type ConfigIdentity, type FeatureAdmission, type FeatureResult, type FeatureSnapshot } from './runnerConfigContract';

export const runModes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'] as const;
export type WorkRequest = { operation: 'work.submit'; api_version: 1; instruction: string }
  | { operation: 'work.status'; api_version: 1; submission_request_id: number }
  | { operation: 'work.list'; api_version: 1; after_event_id: number; limit: number }
  | { operation: 'work.observe'; api_version: 1; observation_id: string };
export type WorkCapability = { version: 1; operations: string[]; run_modes: string[]; origins?: string[]; max_page_size?: number };
export type WorkObservation = {
  observation_id?: string; origin?: 'api' | 'terminal'; submission_request_id: number | null; run_mode: string;
  state: 'dispatching' | 'instruction_admitted' | 'execution_started' | 'active' | 'suspended' | 'incomplete'
    | 'succeeded' | 'failed' | 'interrupted' | 'unknown' | 'rejected';
  admission: 'pending' | 'admitted' | 'rejected' | 'unknown';
  work_id: { kind: string; id: string } | null; execution_id: string;
  event_id: number; started_event_id: number; terminal: boolean;
  outcome: 'pending' | 'succeeded' | 'failed' | 'interrupted' | 'incomplete' | 'unknown' | 'rejected';
  code: string; owner: string; owner_revision: number;
};
export type WorkAttempt = { identity: ConfigIdentity; submissionId?: number; submission?: FeatureResult; observationId?: string;
  status?: FeatureResult; work?: WorkObservation; uncertain: boolean; notSent: boolean; notified?: boolean };
export type WorkActivity = 'idle' | 'running' | 'attention' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export interface WorkTransport {
  identity(): ConfigIdentity | undefined;
  available(operation: WorkRequest['operation'], attachmentLease?: symbol): boolean;
  submit(session: string, request: WorkRequest): Promise<FeatureAdmission>;
}
const settled = (r: FeatureResult) => ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(r.state);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function validIdentity(v: Record<string, unknown>) {
  const id = v.submission_request_id;
  if (v.observation_id === undefined && v.origin === undefined) return positive(id);
  return v.origin === 'api' ? positive(id) && v.observation_id === `api:${id}`
    : v.origin === 'terminal' && id === null && typeof v.observation_id === 'string'
      && /^terminal:[1-9][0-9]*$/.test(v.observation_id) && positive(Number(v.observation_id.slice(9)));
}
type WorkPage = { works: WorkObservation[]; has_more: boolean; next_after_event_id: number; latest_event_id: number };
function isPage(v: unknown, after: number, limit: number): v is WorkPage {
  if (!record(v) || !Array.isArray(v.works) || v.works.length > limit || typeof v.has_more !== 'boolean'
    || !Number.isSafeInteger(v.next_after_event_id) || !Number.isSafeInteger(v.latest_event_id)
    || Number(v.latest_event_id) < after) return false;
  let previous = after;
  for (const work of v.works) {
    if (!isWork(work) || !work.observation_id || work.event_id <= previous || work.event_id > Number(v.latest_event_id)) return false;
    previous = work.event_id;
  }
  return v.has_more ? v.works.length > 0 && v.next_after_event_id === previous && previous < Number(v.latest_event_id)
    : v.next_after_event_id === v.latest_event_id && Number(v.next_after_event_id) >= previous;
}
export function isWork(value: unknown, original?: number): value is WorkObservation {
  if (!record(value) || original !== undefined && value.submission_request_id !== original || !validIdentity(value)
    || !Number.isSafeInteger(value.event_id)
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
  private poll?: ReturnType<typeof setTimeout>;
  private viewed = false;
  unread = false;
  private afterEventId = 0;
  private more = false;
  private discoveryFailed = false;
  private discoveryDisabled = false;
  private waiting?: { id?: number; request: WorkRequest; finish: (result: FeatureResult) => void;
    timer: ReturnType<typeof setTimeout> };
  private readonly requests = new Map<number, WorkRequest>();
  private readonly seen = new Map<number, FeatureResult>();
  constructor(private readonly transport: WorkTransport, private readonly changed: () => void) {}
  get current() { return this.attempts.at(-1); }
  get busy() { return !!this.waiting; }
  get writing() { return this.waiting?.request.operation === 'work.submit'; }
  get activity(): WorkActivity {
    const attempt = this.attempts.filter(a => !a.notSent && (a.uncertain || !a.work?.terminal)).at(-1) ?? this.current;
    const work = attempt?.work;
    if (!attempt || attempt.notSent) return 'idle';
    if (attempt.uncertain || !work || work.state === 'unknown') return 'unknown';
    if (work.terminal) return work.outcome === 'succeeded' ? 'completed'
      : work.outcome === 'failed' || work.outcome === 'rejected' ? 'failed'
        : work.outcome === 'interrupted' ? 'interrupted' : work.outcome === 'incomplete' ? 'attention' : 'unknown';
    return ['suspended', 'incomplete'].includes(work.state) ? 'attention' : 'running';
  }
  setViewed(viewed: boolean) {
    this.viewed = viewed;
    if (viewed && this.unread) { this.unread = false; this.changed(); }
  }
  get blocked() {
    return this.attempts.some(a => !a.notSent && (a.uncertain || !a.work?.terminal || a.work.outcome === 'unknown'));
  }
  get supported() {
    return !this.closed && this.capability?.version === 1
      && ['work.submit', 'work.status'].every(op => this.capability?.operations.includes(op))
      && runModes.every(mode => this.capability?.run_modes.includes(mode));
  }
  get discoverySupported() {
    const cap = this.capability;
    return this.supported && !this.discoveryDisabled && !!cap && ['work.list', 'work.observe'].every(op => cap.operations.includes(op))
      && cap.origins?.length === 2 && ['api', 'terminal'].every(origin => cap.origins?.includes(origin))
      && positive(cap.max_page_size) && cap.max_page_size <= 100;
  }
  observe(session: string, state: string, snapshot?: FeatureSnapshot) {
    if (this.closed) return;
    const identity = state === 'ready' && snapshot && positive(snapshot.generation)
      ? { session, generation: snapshot.generation } : undefined;
    if (this.identity && (session !== this.identity.session
      || snapshot && snapshot.generation !== this.identity.generation)) { this.close(); return; }
    if (identity) this.identity = identity;
    this.snapshot = snapshot;
    this.capability = state === 'ready' ? snapshot?.work ?? undefined : undefined;
    if (this.identity && snapshot?.generation === this.identity.generation)
      for (const result of snapshot.results) this.consume(result);
    const wait = this.waiting;
    const receipt = snapshot?.results.find(r => r.id === wait?.id && r.feature === 'work' && r.operation === wait?.request.operation);
    if (receipt) { this.progress = copy(receipt); if (settled(receipt)) wait?.finish(copy(receipt)); }
    if (state === 'disconnected') this.close();
    else this.scheduleStatus();
  }
  private scheduleStatus() {
    if (this.closed || this.poll || !this.discoverySupported
      && !this.attempts.some(a => a.submissionId && !a.notSent && !a.work?.terminal)) return;
    this.poll = setTimeout(() => {
      this.poll = undefined;
      const operation = this.discoverySupported ? 'work.list' : 'work.status';
      if (this.supported && this.transport.available(operation) && !this.busy) {
        const read = operation === 'work.list'
          ? this.request({ operation, api_version: 1, after_event_id: this.afterEventId, limit: this.capability!.max_page_size! })
          : this.refreshStatus();
        void read.catch(() => {}).finally(() => this.scheduleStatus());
      } else this.scheduleStatus();
    }, this.discoveryFailed || this.current?.uncertain ? 5000 : this.more ? 50 : 1500);
  }
  private consume(result: FeatureResult) {
    if (result.feature !== 'work' || !settled(result)) return;
    const request = this.requests.get(result.id);
    if (request?.operation === 'work.list') { this.consumePage(result, request); return; }
    if (request?.operation === 'work.observe') { this.consumeObservation(result, request.observation_id); return; }
    const original = result.operation === 'work.submit' ? result.id
      : request?.operation === 'work.status' ? request.submission_request_id : undefined;
    if (original === undefined) return;
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
      if (!attempt.work?.terminal) attempt.uncertain = true;
      return;
    }
    const work = reply.work;
    if (result.operation === 'work.submit' && result.state === 'accepted' && reply.receipt !== 'dispatch_received') {
      attempt.uncertain = true; return;
    }
    this.upsert(work, attempt);
    if (request?.operation === 'work.status') { this.requests.delete(result.id); this.seen.delete(result.id); }
  }
  private consumePage(result: FeatureResult, request: Extract<WorkRequest, { operation: 'work.list' }>) {
    if (result.phase === 'completed') this.requests.delete(result.id);
    const reply = result.reply;
    if (result.state !== 'accepted' || result.phase !== 'completed' || !isPage(reply, request.after_event_id, request.limit)) {
      this.discoveryFailed = true;
      if (['WORK_CURSOR_AHEAD', 'UNSUPPORTED_FEATURE', 'UNSUPPORTED_OPERATION', 'UNKNOWN_OPERATION'].includes(result.code ?? ''))
        this.discoveryDisabled = true;
      return;
    }
    if (request.after_event_id !== this.afterEventId) return;
    for (const work of reply.works) this.upsert(work);
    this.afterEventId = reply.next_after_event_id;
    this.more = reply.has_more; this.discoveryFailed = false;
  }
  private consumeObservation(result: FeatureResult, key: string) {
    if (result.phase === 'completed') this.requests.delete(result.id);
    const attempt = this.attempts.find(a => a.observationId === key && same(a.identity, this.identity));
    if (!attempt) return;
    attempt.status = copy(result);
    const reply = result.reply;
    if (result.state !== 'accepted' || result.phase !== 'completed' || !record(reply)
      || !isWork(reply.work) || reply.work.observation_id !== key) {
      if (!attempt.work?.terminal) attempt.uncertain = true;
      return;
    }
    this.upsert(reply.work, attempt);
  }
  private upsert(observation: WorkObservation, attempt?: WorkAttempt) {
    const key = observation.observation_id ?? `api:${observation.submission_request_id}`;
    const work = { ...copy(observation), observation_id: key, origin: observation.origin ?? 'api' as const };
    attempt ??= this.attempts.find(a => same(a.identity, this.identity) && (a.observationId === key
      || work.origin === 'api' && a.submissionId === work.submission_request_id));
    if (!attempt) {
      attempt = { identity: copy(this.identity!), observationId: key, uncertain: false, notSent: false,
        submissionId: work.submission_request_id ?? undefined };
      this.attempts.push(attempt);
    }
    const previous = attempt.work;
    if (previous && work.event_id < previous.event_id) return;
    if (previous && (previous.started_event_id > 0 && work.started_event_id !== previous.started_event_id
      || previous.admission === 'admitted' && work.admission !== 'admitted' || work.owner_revision < previous.owner_revision
      || previous.work_id && !same(previous.work_id, work.work_id)
      || work.event_id === previous.event_id && !same(work, previous))) { attempt.uncertain = true; return; }
    if (previous && same(work, previous) && !attempt.uncertain) return;
    attempt.observationId = key; attempt.work = work; attempt.notSent = false;
    attempt.uncertain = work.outcome === 'unknown' || work.admission === 'unknown';
    if (work.terminal && !attempt.notified && ['succeeded', 'failed', 'interrupted', 'incomplete', 'rejected'].includes(work.outcome)) {
      attempt.notified = true;
      this.unread ||= !this.viewed;
    }
    this.changed();
  }
  private request(request: WorkRequest, attempt?: WorkAttempt, attachmentLease?: symbol): Promise<FeatureResult> {
    const identity = this.transport.identity();
    if (!this.supported || !identity || !same(identity, this.identity) || !this.transport.available(request.operation, attachmentLease) || this.waiting
      || ['work.list', 'work.observe'].includes(request.operation) && !this.discoverySupported)
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
        this.scheduleStatus();
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
          attempt!.submissionId = admission.id;
          attempt!.observationId = `api:${admission.id}`;
          attempt!.notSent = false;
        }
        this.waiting.id = admission.id;
        if (!same(identity, this.transport.identity()) || admission.generation !== identity.generation) {
          finish(unknown(admission.id)); return;
        }
        if (request.operation !== 'work.submit') this.requests.set(admission.id, copy(request));
        // A snapshot can arrive before the native admission promise resolves.
        this.observe(identity.session, 'ready', this.snapshot);
      }, () => finish(unknown()));
    });
  }
  async submit(instruction: string, attachmentLease?: symbol) {
    if (this.blocked || this.busy || !instruction.trim() || instruction.includes('\0') || instruction.trimStart().startsWith('/'))
      throw new HubError(msg('work.unavailable'));
    const identity = this.transport.identity();
    if (!identity || !this.supported) throw new HubError(msg('work.unavailable'));
    const attempt: WorkAttempt = { identity: copy(identity), uncertain: false, notSent: true };
    this.attempts.push(attempt);
    try {
      const result = await this.request({ operation: 'work.submit', api_version: 1, instruction }, attempt, attachmentLease);
      attempt.submission = copy(result);
      if (result.state === 'not-sent' || result.admission === 'rejected') { attempt.notSent = true; return attempt; }
      attempt.notSent = false;
      if (!attempt.submissionId || !attempt.work) { attempt.uncertain = true; return attempt; }
      const deadline = performance.now() + 90000;
      while (!this.closed && !attempt.uncertain && !attempt.work.started_event_id && !attempt.work.terminal
        && !['suspended', 'incomplete', 'failed', 'unknown'].includes(attempt.work.state) && performance.now() < deadline) {
        await this.refresh(attempt);
        if (!attempt.work.started_event_id && !attempt.work.terminal) await new Promise(resolve => setTimeout(resolve, 500));
      }
      return attempt;
    } catch (reason) {
      if (attempt.submissionId || !attempt.notSent) attempt.uncertain = true;
      throw reason;
    }
  }
  async refreshStatus() {
    if (this.current) await this.refresh(this.current);
  }
  private async refresh(attempt: WorkAttempt) {
    if (attempt.notSent || attempt.work?.terminal || this.busy || this.closed) return;
    if (!same(attempt.identity, this.transport.identity()) || !same(attempt.identity, this.identity)) return;
    if (this.discoverySupported && attempt.work?.observation_id) {
      await this.request({ operation: 'work.observe', api_version: 1, observation_id: attempt.work.observation_id });
    } else if (attempt.submissionId) {
      await this.request({ operation: 'work.status', api_version: 1, submission_request_id: attempt.submissionId });
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.poll); this.poll = undefined;
    this.capability = undefined;
    const wait = this.waiting;
    if (wait) wait.finish({ id: wait.id ?? 0, feature: 'work', operation: wait.request.operation,
      state: 'outcome-unknown', admission: 'unconfirmed', code: 'WORK_SESSION_EXITED' });
    for (const attempt of this.attempts) if (!attempt.notSent && !attempt.work?.terminal) attempt.uncertain = true;
    this.changed();
  }
}
