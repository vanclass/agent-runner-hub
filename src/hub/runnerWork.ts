import { HubError, msg } from './i18n';
import type { RunnerObservation } from './runnerControl';
import { copy, record, same, type ConfigIdentity, type FeatureAdmission, type FeatureResult, type FeatureSnapshot } from './runnerConfigContract';

export const runModes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run', 'subagent-run'] as const;
// Hub delivery/start grace beyond the native FIFO deadline; all work waits share it.
const deliveryTimeoutMs = 90000;
export type WorkRequest = { operation: 'work.submit'; api_version: 1; instruction: string }
  | { operation: 'work.status'; api_version: 1; submission_request_id: number }
  | { operation: 'work.list'; api_version: 1; after_event_id: number; limit: number }
  | { operation: 'work.observe'; api_version: 1; observation_id: string };
export type WorkCapability = { version: 1; operations: string[]; run_modes: string[]; origins: string[]; max_page_size: number };
export type WorkObservation = {
  observation_id: string; origin: 'api' | 'terminal'; submission_request_id: number | null; run_mode: string;
  state: 'dispatching' | 'instruction_admitted' | 'execution_started' | 'active' | 'suspended' | 'incomplete'
    | 'succeeded' | 'failed' | 'interrupted' | 'unknown' | 'rejected';
  admission: 'pending' | 'admitted' | 'rejected' | 'unknown';
  work_id: { kind: string; id: string; role_id?: string; workload_name?: string; original_session_id?: string } | null; execution_id: string;
  result?: unknown;
  event_id: number; started_event_id: number; terminal: boolean;
  outcome: 'pending' | 'succeeded' | 'failed' | 'interrupted' | 'incomplete' | 'unknown' | 'rejected';
  code: string; owner: string; owner_revision: number;
};
export type WorkAttempt = { identity: ConfigIdentity; readonly instruction?: string; submissionId?: number; submission?: FeatureResult; observationId?: string;
  status?: FeatureResult; work?: WorkObservation; uncertain: boolean; notSent: boolean; notified?: boolean };
export type WorkActivity = 'idle' | 'running' | 'attention' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export function issueUserAction(attempt: WorkAttempt | undefined, observation: RunnerObservation) {
  const signal = observation.issue_run_user_action;
  const work = attempt?.work;
  const unbound = signal?.status === 'not_required' && signal.issue_run_id === '' && signal.state_revision === null
    && (!work || work.terminal);
  if (observation.run_mode !== 'issue-run' || !signal || signal.schema_version !== 'issue-run-user-action-v1'
    || !['required', 'not_required', 'unknown'].includes(signal.status)
    || typeof signal.issue_run_id !== 'string' || !unbound && (!signal.issue_run_id
      || !Number.isSafeInteger(signal.state_revision) || Number(signal.state_revision) < 0)
    || !Array.isArray(signal.requirements) || !signal.requirements.every(r => r
      && (['clarification', 'approval', 'discussion'].includes(r.kind)
        ? r.request_key === '' && r.request_version === ''
        : ['dialogue', 'human_request'].includes(r.kind) && nonempty(r.request_key) && nonempty(r.request_version)))
    || (signal.status === 'required' ? !signal.requirements.length : !!signal.requirements.length)
    // Work discovery and the authenticated user-action projection sample independently.
    || work && !unbound && (work.run_mode !== 'issue-run'
      || work.work_id && (work.work_id.kind !== 'issue' || work.work_id.id !== signal.issue_run_id)
      || work.owner_revision > Number(signal.state_revision))) return 'unknown';
  return signal.status;
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function issueExecution(observation: RunnerObservation, action: ReturnType<typeof issueUserAction>) {
  const signal = observation.issue_run_execution;
  const wait = observation.issue_run_user_action;
  if (!signal || !wait || action === 'unknown' || signal.schema_version !== 'issue-run-execution-v1'
    || signal.issue_run_id !== wait.issue_run_id) return undefined;
  // The producer can prove a committed wait while native execution is indeterminate.
  if (signal.status === 'unknown' && signal.state_revision === null && signal.interpreter === null) return 'unknown';
  if (signal.state_revision !== wait.state_revision) return undefined;
  if (signal.status === 'running') {
    const i = signal.interpreter;
    return signal.issue_run_id && i && positive(i.launch_generation)
      && [i.invocation_id, i.instance_id, i.thread_id, i.turn_id].every(nonempty) ? 'running' : undefined;
  }
  return ['idle', 'unknown', 'unsupported'].includes(signal.status) && signal.interpreter === null
    ? signal.status : undefined;
}
/** Presentation only: IssueRun foreground ownership is not a user-handoff signal. */
export function issueSidebarActivity(attempt: WorkAttempt | undefined, observation: RunnerObservation): WorkActivity {
  if (observation.run_mode !== 'issue-run') return 'unknown';
  const { execution, attention } = observation;
  if (attention.restart_confirmation_required || attention.termination_confirmation_active
    || attention.account_setup_required) return 'attention';
  const userAction = issueUserAction(attempt, observation);
  const hasActivity = observation.issue_run_execution !== undefined;
  const interpreter = issueExecution(observation, userAction);
  if (hasActivity && interpreter === undefined) return 'unknown';
  if (userAction === 'required') return 'attention';
  if (observation.issue_run_user_action !== undefined && userAction === 'unknown') return 'unknown';
  if (interpreter === 'running' || !hasActivity && execution.owned_execution_alive === true) return 'running';
  if (hasActivity && interpreter !== 'idle') return 'unknown';
  const work = attempt?.work;
  // Work v1 conflates automatic next_action and user dialogue in incomplete.
  if (attention.awaiting_user_command_reason || attention.suspension_status !== 'inactive'
    || attention.suspension_reason) return 'unknown';
  const released = execution.lifecycle_state === 'INTERACTIVE_READY'
    && execution.owned_execution_alive === false && execution.workflow_kind === ''
    && !attention.foreground_interaction_active;
  if (!attempt || attempt.notSent) return released ? 'idle' : 'unknown';
  if (attempt.uncertain || !work || work.run_mode !== 'issue-run'
    || ['unknown', 'suspended', 'incomplete'].includes(work.state)) return 'unknown';
  if (work.terminal) return released && ['succeeded', 'failed', 'interrupted', 'rejected'].includes(work.outcome)
    ? 'idle' : 'unknown';
  // A prior started Work can be marked active during a successor's reservation.
  if (hasActivity && work.owner_revision !== observation.issue_run_execution?.state_revision) return 'unknown';
  return work.admission === 'admitted' && positive(work.started_event_id)
    && ['execution_started', 'active'].includes(work.state)
    ? 'running' : 'unknown';
}
export interface WorkTransport {
  identity(): ConfigIdentity | undefined;
  available(operation: WorkRequest['operation'], attachmentLease?: symbol): boolean;
  submit(session: string, request: WorkRequest): Promise<FeatureAdmission>;
}
const settled = (r: FeatureResult) => ['accepted', 'rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(r.state);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function validIdentity(v: Record<string, unknown>) {
  const id = v.submission_request_id;
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
    if (!validWork(work, undefined, true) || !work.observation_id || work.event_id <= previous || work.event_id > Number(v.latest_event_id)) return false;
    previous = work.event_id;
  }
  return v.has_more ? v.works.length > 0 && v.next_after_event_id === previous && previous < Number(v.latest_event_id)
    : v.next_after_event_id === v.latest_event_id && Number(v.next_after_event_id) >= previous;
}
export function isWork(value: unknown, original?: number): value is WorkObservation {
  return validWork(value, original, false);
}
function validWork(value: unknown, original?: number, allowUnknown = false): value is WorkObservation {
  if (!record(value) || original !== undefined && value.submission_request_id !== original || !validIdentity(value)
    || !Number.isSafeInteger(value.event_id)
    || Number(value.event_id) < 1 || !Number.isSafeInteger(value.started_event_id) || Number(value.started_event_id) < 0
    || Number(value.started_event_id) > Number(value.event_id) || !Number.isSafeInteger(value.owner_revision)
    || Number(value.owner_revision) < 0 || typeof value.run_mode !== 'string' || !value.run_mode
    || !allowUnknown && !runModes.includes(value.run_mode as typeof runModes[number])) return false;
  return ['dispatching', 'instruction_admitted', 'execution_started', 'active', 'suspended', 'incomplete', 'succeeded',
    'failed', 'interrupted', 'unknown', 'rejected'].includes(String(value.state))
    && ['pending', 'admitted', 'rejected', 'unknown'].includes(String(value.admission))
    && ['pending', 'succeeded', 'failed', 'interrupted', 'incomplete', 'unknown', 'rejected'].includes(String(value.outcome))
    && typeof value.terminal === 'boolean' && ['code', 'owner', 'execution_id'].every(k => typeof value[k] === 'string')
    && (value.work_id === null || record(value.work_id) && (allowUnknown && !runModes.includes(value.run_mode as typeof runModes[number])
      || ['direct_turn', 'task', 'issue', 'subagent_turn'].includes(String(value.work_id.kind)))
      && typeof value.work_id.kind === 'string' && !!value.work_id.kind
      && typeof value.work_id.id === 'string' && !!value.work_id.id
      && ['role_id', 'workload_name', 'original_session_id'].every(k => (value.work_id as Record<string, unknown>)[k] === undefined
        || typeof (value.work_id as Record<string, unknown>)[k] === 'string'))
    && (value.result === undefined || value.result === null || record(value.result))
    && (!value.started_event_id || value.admission === 'admitted') && (!value.terminal || value.outcome !== 'pending');
}

/** Process-local observations; exact durable recovery references belong to RunnerRecovery. */
export class RunnerWork {
  readonly attempts: WorkAttempt[] = [];
  capability?: WorkCapability;
  progress?: FeatureResult;
  private snapshot?: FeatureSnapshot;
  private identity?: ConfigIdentity;
  private runMode?: string;
  private closed = false;
  private inventory?: Promise<void>;
  private inventoryDirty = true;
  private coverageRevision = 0;
  private inventoryUnverified = false;
  private inventoryVerified = false;
  private coverage = false;
  private deferredWork: WorkObservation[] = [];
  private wakeStart?: () => void;
  private pendingStart?: { attempt: WorkAttempt; coverageInterrupted: boolean; checkedRevision?: number };
  private refreshing?: { attempt: WorkAttempt; revision: number; result: Promise<FeatureResult> };
  private discoveryPaused = false;
  private viewed = false;
  unread = false;
  private afterEventId = 0;
  private presentationAfter = -1;
  private previousAttempts = new Set<WorkAttempt>();
  private more = false;
  private discoveryFailed = false;
  private discoveryDisabled = false;
  private waiting?: { id?: number; request: WorkRequest; finish: (result: FeatureResult) => void;
    timer: ReturnType<typeof setTimeout> };
  private readonly requests = new Map<number, WorkRequest>();
  private readonly seen = new Map<number, FeatureResult>();
  private readonly confirmedStarts = new WeakSet<WorkAttempt>();
  constructor(private readonly transport: WorkTransport, private readonly changed: () => void) {}
  private latest(attempts: readonly WorkAttempt[]) {
    let latest: WorkAttempt | undefined;
    for (const attempt of attempts) {
      if (!latest || !attempt.work || latest.work && attempt.work.event_id >= latest.work.event_id) latest = attempt;
    }
    return latest;
  }
  get current() { return this.latest(this.attempts); }
  hasConfirmedStart(attempt: WorkAttempt) {
    return !attempt.notSent && this.confirmedStarts.has(attempt);
  }
  hasLiveIssueStart(attempt: WorkAttempt, observation: RunnerObservation) {
    const { work, submissionId, identity } = attempt;
    if (this.closed || attempt.notSent || attempt.uncertain || !positive(submissionId)
      || !same(identity, this.identity) || !same(identity, this.transport.identity())
      || !work || work.origin !== 'api' || work.observation_id !== `api:${submissionId}`
      || work.submission_request_id !== submissionId || work.run_mode !== 'issue-run'
      || work.terminal || work.admission !== 'admitted' || work.started_event_id !== 0
      || work.work_id?.kind !== 'issue' || observation.run_mode !== 'issue-run') return false;
    const live = observation.issue_run_execution;
    const native = live?.interpreter;
    return live?.schema_version === 'issue-run-execution-v1' && live.status === 'running'
      && !!live.issue_run_id && live.issue_run_id === work.work_id.id
      && positive(live.state_revision) && live.state_revision === work.owner_revision
      && !!native && positive(native.launch_generation)
      && [native.invocation_id, native.thread_id, native.turn_id, native.instance_id]
        .every(id => typeof id === 'string' && id.length > 0);
  }
  get presentedAttempts() {
    return this.attempts.filter(a => !this.previousAttempts.has(a)
      && (!a.work || a.work.event_id > this.presentationAfter));
  }
  get presentedCurrent() { return this.latest(this.presentedAttempts); }
  beginPresentation() {
    this.previousAttempts = new Set(this.attempts);
    this.presentationAfter = this.attempts.reduce((latest, attempt) => Math.max(latest, attempt.work?.event_id ?? 0), this.afterEventId);
    this.unread = false;
    this.discoveryPaused = false;
    this.syncInventory();
  }
  suspendDiscovery() {
    this.discoveryPaused = true;
  }
  coverageChanged(covered: boolean) {
    this.inventoryUnverified ||= this.coverage && !covered;
    if (this.pendingStart && (this.coverage || covered)) this.pendingStart.coverageInterrupted = true;
    this.coverage = covered;
    this.coverageRevision++;
    this.inventoryVerified = false;
    this.inventoryDirty = covered;
    this.wakeStart?.();
  }
  syncInventory() {
    if (!this.inventoryDirty || this.discoveryPaused || this.busy || this.inventory
      || !this.discoverySupported || !this.transport.available('work.list')) return;
    void this.refreshInventory().catch(() => {});
  }
  refreshInventory() {
    if (this.inventory) return this.inventory;
    if (!this.supports('work.list')) return Promise.resolve();
    if (!this.discoverySupported) return Promise.reject(new HubError(msg('work.unavailable')));
    if (!this.inventoryDirty && this.coverage && this.inventoryVerified) return Promise.resolve();
    this.inventoryDirty = false;
    this.afterEventId = 0;
    const revision = this.coverageRevision;
    this.inventory = this.readInventory(revision).finally(() => {
      this.inventory = undefined;
      this.wakeStart?.();
      this.changed();
    });
    return this.inventory;
  }
  private async readInventory(revision: number) {
    do {
      await this.request({ operation: 'work.list', api_version: 1,
        after_event_id: this.afterEventId, limit: this.capability!.max_page_size! });
      if (this.discoveryFailed) throw new HubError(msg('work.unavailable'));
    } while (this.more && revision === this.coverageRevision);
    if (revision !== this.coverageRevision) throw new HubError(msg('work.unavailable'));
    this.inventoryVerified = true;
    this.inventoryUnverified = false;
    this.wakeStart?.();
  }
  get busy() { return !!this.waiting; }
  get writing() { return this.waiting?.request.operation === 'work.submit'; }
  get activity(): WorkActivity {
    const attempt = this.latest(this.attempts.filter(a => !a.notSent && (a.uncertain || !a.work?.terminal))) ?? this.current;
    return this.activityFor(attempt);
  }
  get presentedActivity(): WorkActivity {
    return this.activityFor(this.presentedCurrent);
  }
  private activityFor(attempt?: WorkAttempt): WorkActivity {
    if (this.inventoryUnverified) return 'unknown';
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
    return this.inventoryUnverified || this.attempts.some(a => !a.notSent && (a.uncertain || !a.work?.terminal || a.work.outcome === 'unknown'));
  }
  get supported() {
    return this.supports('work.submit');
  }
  supports(operation: WorkRequest['operation'], mode = this.runMode) {
    const cap = this.capability;
    return !this.closed && cap?.version === 1
      && Array.isArray(cap.operations) && Array.isArray(cap.run_modes)
      && cap.operations.includes(operation)
      && (mode ? runModes.includes(mode as typeof runModes[number]) && cap.run_modes.includes(mode)
        : runModes.some(mode => cap.run_modes.includes(mode)))
      && cap.origins?.length === 2 && ['api', 'terminal'].every(origin => cap.origins.includes(origin))
      && positive(cap.max_page_size) && cap.max_page_size <= 100;
  }
  get discoverySupported() {
    return this.supports('work.list') && !this.discoveryDisabled;
  }
  observe(session: string, state: string, snapshot?: FeatureSnapshot, runMode?: string) {
    if (this.closed) return;
    const identity = state !== 'disconnected' && snapshot && positive(snapshot.generation)
      ? { session, generation: snapshot.generation } : undefined;
    if (this.identity && (session !== this.identity.session
      || snapshot && snapshot.generation !== this.identity.generation)) { this.close(); return; }
    if (identity) this.identity = identity;
    this.snapshot = snapshot;
    if (runMode !== undefined) this.runMode = runMode;
    this.capability = state === 'ready' ? snapshot?.work ?? undefined : undefined;
    if (this.identity && snapshot?.generation === this.identity.generation)
      for (const result of snapshot.results) this.consume(result);
    const wait = this.waiting;
    const receipt = snapshot?.results.find(r => r.id === wait?.id && r.feature === 'work' && r.operation === wait?.request.operation);
    if (receipt) { this.progress = copy(receipt); if (settled(receipt)) wait?.finish(copy(receipt)); }
    if (state === 'disconnected') this.close();
    this.wakeStart?.();
  }
  receive(payload: Record<string, unknown>) {
    if (!this.identity || !['created', 'updated'].includes(String(payload.change)) || !isWork(payload.work)) return;
    if (payload.work.origin === 'api' && this.writing && !this.waiting?.id) {
      this.deferredWork.push(payload.work);
      return;
    }
    this.upsert(payload.work);
  }
  private flushDeferred() {
    for (const work of this.deferredWork.splice(0)) this.upsert(work);
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
    for (const work of reply.works) if (isWork(work)) this.upsert(work);
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
    const key = observation.observation_id;
    const work = copy(observation);
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
      || work.event_id === previous.event_id && !same(work, previous))) {
      this.confirmedStarts.delete(attempt); attempt.uncertain = true; return;
    }
    if (previous && same(work, previous) && !attempt.uncertain) return;
    attempt.observationId = key; attempt.work = work; attempt.notSent = false;
    // A verified start remains evidence even when its completion outcome is unknown.
    if (work.started_event_id > 0) this.confirmedStarts.add(attempt);
    else this.confirmedStarts.delete(attempt);
    attempt.uncertain = work.outcome === 'unknown' || work.admission === 'unknown';
    if (work.terminal && !attempt.notified && ['succeeded', 'failed', 'interrupted', 'incomplete', 'rejected'].includes(work.outcome)) {
      attempt.notified = true;
      this.unread ||= !this.viewed && this.presentedAttempts.includes(attempt);
    }
    this.wakeStart?.();
    this.changed();
  }
  private request(request: WorkRequest, attempt?: WorkAttempt, attachmentLease?: symbol): Promise<FeatureResult> {
    const identity = this.transport.identity();
    if (!this.supports(request.operation) || !identity || !same(identity, this.identity)
      || !this.transport.available(request.operation, attachmentLease) || this.waiting
      || request.operation === 'work.list' && !this.discoverySupported)
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
        this.flushDeferred();
        this.changed();
        resolve(result);
      };
      this.waiting = { request, finish, timer: setTimeout(() => finish(unknown()), deliveryTimeoutMs) };
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
          attempt!.notSent = false;
        }
        this.waiting.id = admission.id;
        if (!same(identity, this.transport.identity()) || admission.generation !== identity.generation) {
          finish(unknown(admission.id)); return;
        }
        if (request.operation !== 'work.submit') this.requests.set(admission.id, copy(request));
        this.flushDeferred();
        // A snapshot can arrive before the native admission promise resolves.
        this.observe(identity.session, 'ready', this.snapshot);
      }, () => finish(unknown()));
    });
  }
  async submit(instruction: string, attachmentLease?: symbol, onAttempt?: (attempt: WorkAttempt) => void) {
    if (this.blocked || this.busy || !instruction.trim() || instruction.includes('\0') || instruction.trimStart().startsWith('/'))
      throw new HubError(msg('work.unavailable'));
    const identity = this.transport.identity();
    if (!identity || !this.supported) throw new HubError(msg('work.unavailable'));
    const attempt: WorkAttempt = { identity: copy(identity), instruction, uncertain: false, notSent: true };
    this.attempts.push(attempt);
    this.pendingStart = { attempt, coverageInterrupted: false };
    onAttempt?.(attempt);
    try {
      const result = await this.request({ operation: 'work.submit', api_version: 1, instruction }, attempt, attachmentLease);
      attempt.submission = copy(result);
      if (result.state === 'not-sent' || result.admission === 'rejected') { attempt.notSent = true; return attempt; }
      attempt.notSent = false;
      if (!attempt.submissionId || !attempt.work) attempt.uncertain = true;
      await this.awaitStart(attempt);
      return attempt;
    } catch (reason) {
      if (attempt.submissionId || !attempt.notSent) attempt.uncertain = true;
      throw reason;
    } finally {
      if (attempt.notSent && this.pendingStart?.attempt === attempt) this.pendingStart = undefined;
    }
  }
  private async awaitStart(attempt: WorkAttempt) {
    const done = () => this.closed || attempt.uncertain || !attempt.work || attempt.work.started_event_id > 0
      || attempt.work.terminal || ['suspended', 'incomplete', 'failed', 'unknown'].includes(attempt.work.state);
    if (!done() && !this.coverage && this.pendingStart?.attempt === attempt)
      this.pendingStart.coverageInterrupted = true;
    const interrupted = () => this.pendingStart?.attempt === attempt && this.pendingStart.coverageInterrupted;
    if (!done() && !interrupted()) await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.wakeStart = undefined; resolve(); };
      const timer = setTimeout(finish, deliveryTimeoutMs);
      this.wakeStart = () => { if (done() || interrupted()) finish(); };
    });
    if (interrupted()) await this.syncSubmission();
  }
  async refreshStatus() {
    const attempt = this.current;
    if (attempt) await this.refresh(attempt, this.refreshRequest(attempt));
  }
  get refreshSupported() {
    return !!this.refreshRequest(this.current);
  }
  private refreshRequest(attempt?: WorkAttempt): WorkRequest | undefined {
    if (!attempt || attempt.notSent || attempt.work?.terminal || this.closed) return;
    if (!same(attempt.identity, this.transport.identity()) || !same(attempt.identity, this.identity)) return;
    if (this.supports('work.observe') && attempt.observationId)
      return { operation: 'work.observe', api_version: 1, observation_id: attempt.observationId };
    if (this.supports('work.status') && attempt.submissionId)
      return { operation: 'work.status', api_version: 1, submission_request_id: attempt.submissionId };
  }
  syncSubmission() {
    const pending = this.pendingStart;
    if (!pending) return;
    const { attempt } = pending;
    if (this.hasConfirmedStart(attempt) || attempt.work?.terminal
      || !attempt.uncertain && attempt.work?.admission === 'rejected') {
      this.pendingStart = undefined;
      return;
    }
    if (!pending.coverageInterrupted) return;
    const request = this.refreshRequest(attempt);
    if (!request) return;
    if (this.refreshing) {
      if (this.refreshing.attempt !== attempt) return;
      if (this.refreshing.revision === this.coverageRevision) pending.checkedRevision = this.coverageRevision;
      return this.refreshing.result;
    }
    // A read that leaves the start unresolved is bounded to this coverage revision.
    if (pending.checkedRevision === this.coverageRevision || this.busy
      || !this.transport.available(request.operation)) return;
    pending.checkedRevision = this.coverageRevision;
    return this.refresh(attempt, request);
  }
  private refresh(attempt: WorkAttempt, request?: WorkRequest) {
    if (!request) return;
    if (this.refreshing) return this.refreshing.attempt === attempt ? this.refreshing.result : undefined;
    if (this.busy) return;
    const revision = this.coverageRevision;
    const result = this.request(request).finally(() => {
      this.refreshing = undefined;
      this.changed();
    });
    this.refreshing = { attempt, revision, result };
    return result;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.wakeStart?.();
    this.capability = undefined;
    const wait = this.waiting;
    if (wait) wait.finish({ id: wait.id ?? 0, feature: 'work', operation: wait.request.operation,
      state: 'outcome-unknown', admission: 'unconfirmed', code: 'WORK_SESSION_EXITED' });
    for (const attempt of this.attempts) if (!attempt.notSent && !attempt.work?.terminal) attempt.uncertain = true;
    this.changed();
  }
}
