import { msg, type HubText } from './i18n';
import { record, same, type ConfigIdentity, type FeatureAdmission } from './runnerConfigContract';
import type { ControlSnapshot, RunnerObservation } from './runnerControl';
import { supportsRun, isRunObservation, isRunReceipt, type RunObservation, type RunRequest } from './runnerRunContract';

export type BriefResult = { brief: true; staged: boolean; status: 'completed' | 'rejected' | 'unknown';
  identity?: ConfigIdentity; stagingRequest?: FeatureAdmission; runRequest?: FeatureAdmission;
  statusRequest?: FeatureAdmission; initiation?: RunObservation; code?: string | null;
  outcome?: 'started' | 'pending' | 'not_started' | 'owner_returned' | 'attention' | 'unknown' };
type BriefPort = {
  identity: () => ConfigIdentity | undefined;
  available: (lease?: symbol, statusOnly?: boolean) => boolean;
  stage: (session: string, body: string) => Promise<FeatureAdmission>;
  run: (session: string, request: RunRequest) => Promise<FeatureAdmission>;
  completionMs: number;
  runCoverage: () => number | undefined;
  observation: (id: number) => RunObservation | undefined;
  when: <T>(read: () => T | undefined, timeout: number) => Promise<T | undefined>;
};

/** Owns stage → invoke → initiation observation, never Runner execution or lifecycle. */
export class RunnerBrief {
  busy = false;
  blocked = false;
  detail: HubText = '';
  result?: BriefResult;
  private snapshot?: ControlSnapshot;
  private wake?: () => void;
  private reconciling = false;
  private submissionCoverage?: number;
  private statusRead = false;
  private staging?: { revision: number; count: number };
  private stagedRequest?: number;
  get stagedCount() { return this.snapshot?.deliveryIncomplete ? undefined : this.staging?.count; }
  constructor(private readonly port: BriefPort, private readonly changed: () => void) {}
  observe(snapshot: ControlSnapshot) {
    if (this.snapshot?.presentationGeneration !== snapshot.presentationGeneration) {
      this.staging = undefined;
      this.stagedRequest = undefined;
    }
    this.snapshot = snapshot;
    this.mergeStaging(snapshot.observation?.brief_staging);
    this.wake?.();
  }
  receiveBrief(payload: Record<string, unknown>) {
    if (!['staged', 'consumed', 'cleared'].includes(String(payload.action)) || !this.mergeStaging(payload)) return;
    if (payload.action === 'staged' && Number(payload.count) > 0 && Number.isSafeInteger(payload.staging_request_id)
      && Number(payload.staging_request_id) > 0) this.stagedRequest = Number(payload.staging_request_id);
    this.wake?.();
  }
  private mergeStaging(payload: unknown) {
    if (!record(payload) || !Number.isSafeInteger(payload.revision) || !Number.isSafeInteger(payload.count)
      || Number(payload.count) < 0 || Number(payload.revision) <= (this.staging?.revision ?? -1)) return false;
    this.staging = { revision: Number(payload.revision), count: Number(payload.count) };
    return true;
  }
  private async receipt(identity: ConfigIdentity, admission: FeatureAdmission, operation: 'brief.stage' | RunRequest['operation']) {
    if (admission.state !== 'submitted') return admission.state === 'not-sent' ? 'rejected' : 'unknown';
    if (admission.generation !== identity.generation) return 'unknown';
    return new Promise<'completed' | 'rejected' | 'unknown'>(resolve => {
      const finish = (state: 'completed' | 'rejected' | 'unknown') => {
        clearTimeout(timer); this.wake = undefined; resolve(state);
      };
      const timer = setTimeout(() => finish('unknown'), this.port.completionMs);
      this.wake = () => {
        const snapshot = this.snapshot;
        if (!this.current(identity)) { finish('unknown'); return; }
        const result = snapshot?.features?.results.find(r => r.id === admission.id
          && r.feature === (operation === 'brief.stage' ? 'brief' : 'run') && r.operation === operation);
        if (operation === 'brief.stage' && this.stagedRequest === admission.id) { finish('completed'); return; }
        if (!result) return;
        if (result.state === 'outcome-unknown') { finish('unknown'); return; }
        if (result.state === 'not-sent' || result.state === 'rejected' || result.state === 'failure') {
          finish('rejected'); return;
        }
        if (result.state !== 'accepted' || result.phase !== 'completed') return;
        if (operation === 'brief.stage') {
          const reply = 'reply' in result ? result.reply : undefined;
          finish(record(reply) && reply.staging_status === 'staged' && reply.owner === 'brief_staging'
            && Number.isSafeInteger(reply.count) && Number(reply.count) > 0 && reply.outcome_unknown === false
            ? 'completed' : 'unknown');
        } else finish('completed');
      };
      this.wake();
    });
  }
  private current(identity: ConfigIdentity) {
    return same(identity, this.port.identity()) && this.snapshot?.state === 'ready';
  }
  hasLiveIssueStart(attempt: BriefResult, observation: RunnerObservation) {
    const { identity, runRequest, initiation } = attempt;
    if (this.result !== attempt || attempt.status !== 'completed' || !identity || !this.current(identity)
      || runRequest?.state !== 'submitted' || runRequest.generation !== identity.generation
      || initiation?.initiation_status !== 'started' || initiation.lifecycle_terminal
      || initiation.invocation_request_id !== runRequest.id || observation.run_mode !== 'issue-run') return false;
    const latest = this.port.observation(runRequest.id);
    if (latest && (latest.lifecycle_terminal || latest.issue_run_id !== initiation.issue_run_id)) return false;

    const live = observation.issue_run_execution;
    const native = live?.interpreter;
    return live?.schema_version === 'issue-run-execution-v1' && live.status === 'running'
      && live.issue_run_id === initiation.issue_run_id && live.state_revision !== null
      && Number.isSafeInteger(live.state_revision) && live.state_revision >= initiation.state_revision
      && !!native && Number.isSafeInteger(native.launch_generation) && native.launch_generation > 0
      && [native.invocation_id, native.thread_id, native.turn_id, native.instance_id]
        .every(id => typeof id === 'string' && id.length > 0);
  }
  private async readInitiation(identity: ConfigIdentity, original: number, evidence: Partial<BriefResult>) {
    const admission = await this.port.run(identity.session,
      { operation: 'run.status', api_version: 1, invocation_request_id: original });
    evidence.statusRequest = admission;
    if (await this.receipt(identity, admission, 'run.status') !== 'completed'
      || admission.state !== 'submitted' || !this.current(identity)) return;
    const result = this.snapshot?.features?.results.find(r => r.id === admission.id
      && r.feature === 'run' && r.operation === 'run.status');
    evidence.code = result?.code;
    const reply = result?.reply;
    if (!record(reply) || !isRunObservation(reply.run, original)) return;
    return this.port.observation(original) ?? reply.run;
  }
  async reconcile(attempt: BriefResult, lease?: symbol) {
    const { identity, runRequest } = attempt;
    if (this.result !== attempt || attempt.status !== 'unknown' || this.busy || this.reconciling
      || !identity || runRequest?.state !== 'submitted' || runRequest.generation !== identity.generation
      || !Number.isSafeInteger(runRequest.id) || runRequest.id < 1 || !this.current(identity)
      || !supportsRun(this.snapshot?.features?.run, 'run.status') || !this.port.available(lease, true)) return;
    const pushed = this.port.observation(runRequest.id);
    if (pushed && this.applyReconciliation(attempt, pushed, {})) return;
    const scope = this.port.runCoverage();
    if (this.statusRead || scope !== undefined && scope === this.submissionCoverage) return;
    this.statusRead = true;
    this.reconciling = true;
    const evidence: Partial<BriefResult> = {};
    try {
      const run = await this.readInitiation(identity, runRequest.id, evidence);
      if (this.result !== attempt || !this.current(identity) || !run) return;
      this.applyReconciliation(attempt, run, evidence);
    } catch {
      // A status read can fail without settling the original invocation.
    } finally {
      this.reconciling = false;
    }
  }
  private applyReconciliation(attempt: BriefResult, run: RunObservation, evidence: Partial<BriefResult>) {
    if (run.initiation_status !== 'started' && run.initiation_status !== 'not_started') return false;
    const started = run.initiation_status === 'started';
    Object.assign(attempt, evidence, { initiation: run, status: started ? 'completed' : 'rejected',
      outcome: started ? 'started' : 'not_started' });
    this.blocked = !started && attempt.staged;
    this.detail = msg(started ? 'brief.requested' : 'brief.notStarted');
    this.changed();
    return true;
  }
  updateRun() {
    const attempt = this.result, request = attempt?.runRequest;
    if (attempt?.status !== 'unknown' || !attempt.identity || !this.current(attempt.identity)
      || request?.state !== 'submitted') return;
    const run = this.port.observation(request.id);
    if (run) this.applyReconciliation(attempt, run, {});
  }
  private async initiation(identity: ConfigIdentity, original: number, evidence: Partial<BriefResult>): Promise<BriefResult['status']> {
    evidence.outcome = 'pending'; this.detail = msg('brief.pending'); this.changed();
    const pushed = await this.port.when(() => {
      if (!this.current(identity)) return false as const;
      const run = this.port.observation(original);
      if (run?.initiation_status !== 'pending') return run;
      const scope = this.port.runCoverage();
      if (this.submissionCoverage === undefined || scope !== undefined && scope !== this.submissionCoverage) return null;
    }, this.port.completionMs);
    const needsStatus = pushed === null || pushed === undefined && this.port.runCoverage() !== this.submissionCoverage;
    let run = pushed || undefined;
    if (needsStatus && this.current(identity)) {
      this.statusRead = true;
      run = await this.readInitiation(identity, original, evidence);
    }
    if (!run || run.initiation_status === 'pending') return 'unknown';
    evidence.initiation = run;
    if (run.initiation_status === 'started') { evidence.outcome = 'started'; return 'completed'; }
    evidence.outcome = run.user_input_required || ['SUSPENDED', 'PAUSED', 'WAITING_FOR_HUMAN'].includes(run.owner_status)
      ? 'attention' : run.initiation_status === 'not_started' ? 'not_started'
        : run.dispatch_status === 'returned' ? 'owner_returned' : 'unknown';
    return run.initiation_status === 'not_started' ? 'rejected' : 'unknown';
  }
  async submit(body: string, lease?: symbol, text?: string): Promise<BriefResult> {
    const identity = this.port.identity(), snapshot = this.snapshot;
    if (this.busy || this.blocked) return { brief: true, staged: false, status: 'rejected' };
    this.result = undefined;
    this.statusRead = false;
    if (!identity || !this.port.available(lease) || snapshot?.observation?.run_mode !== 'issue-run'
      || body.length > 0 && (snapshot.features?.brief?.version !== 1 || !snapshot.features.brief.operations.includes('brief.stage'))
      || !supportsRun(snapshot.features?.run, 'run.invoke') || !supportsRun(snapshot.features?.run, 'run.status')) {
      this.detail = msg('brief.unavailable'); this.changed();
      return this.result = { brief: true, staged: false, status: 'rejected' };
    }
    this.busy = true; this.detail = msg(body.length ? 'brief.staging' : 'brief.runRequesting'); this.changed();
    let staged = false, status: BriefResult['status'] = 'unknown';
    let stagingRequest: FeatureAdmission | undefined, runRequest: FeatureAdmission | undefined;
    const evidence: Partial<BriefResult> = {};
    try {
      if (body.length > 0) {
        stagingRequest = await this.port.stage(identity.session, body);
        status = await this.receipt(identity, stagingRequest, 'brief.stage');
        staged = status === 'completed';
      } else status = 'completed';
      if (status === 'completed') {
        if (staged) { this.detail = msg('brief.staged'); this.changed(); }
        if (!this.current(identity)) status = 'unknown';
        else if (!supportsRun(this.snapshot?.features?.run, 'run.invoke')
          || !supportsRun(this.snapshot?.features?.run, 'run.status')) status = 'rejected';
        else {
          this.detail = msg(staged ? 'brief.requesting' : 'brief.runRequesting'); this.changed();
          this.submissionCoverage = this.port.runCoverage();
          runRequest = await this.port.run(identity.session,
            { operation: 'run.invoke', api_version: 1, ...(text !== undefined && text.length > 0 ? { text } : {}) });
          status = await this.receipt(identity, runRequest, 'run.invoke');
          if (runRequest.state === 'not-sent') status = 'unknown';
          if (runRequest.state === 'submitted') {
            const original = runRequest.id;
            const result = this.snapshot?.features?.results.find(r => r.id === original && r.operation === 'run.invoke');
            evidence.code = result?.code;
            if (status === 'completed') {
              const reply = result?.reply;
              status = isRunReceipt(reply, runRequest.id)
                ? await this.initiation(identity, runRequest.id, evidence) : 'unknown';
            }
          }
        }
      }
    } catch { status = 'unknown'; }
    finally { this.busy = false; }
    this.blocked = staged && status !== 'completed' || status === 'unknown';
    this.detail = msg(status === 'completed' ? 'brief.requested' : evidence.outcome === 'attention' ? 'brief.attention'
      : evidence.outcome === 'not_started' ? 'brief.notStarted' : evidence.outcome === 'owner_returned' ? 'brief.ownerReturned'
      : status === 'unknown'
      ? staged ? 'brief.runUnknown' : 'brief.stageUnknown' : staged ? 'brief.runRejected' : 'brief.stageRejected');
    this.result = { brief: true, staged, status, identity, stagingRequest, runRequest, ...evidence }; this.changed();
    if (!body.length) {
      this.detail = msg(status === 'completed' ? 'brief.runConfirmed' : status === 'unknown' ? 'brief.runUnconfirmed' : 'brief.runDeclined');
      this.changed();
    }
    return this.result;
  }
}
