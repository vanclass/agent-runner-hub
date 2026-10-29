import { msg, type HubText } from './i18n';
import { record, same, type ConfigIdentity, type FeatureAdmission } from './runnerConfigContract';
import type { ControlSnapshot } from './runnerControl';
import { supportsRun, isRunObservation, type RunObservation, type RunRequest } from './runnerRunContract';

export type BriefResult = { brief: true; staged: boolean; status: 'completed' | 'rejected' | 'unknown';
  identity?: ConfigIdentity; stagingRequest?: FeatureAdmission; runRequest?: FeatureAdmission;
  statusRequest?: FeatureAdmission; initiation?: RunObservation; code?: string | null;
  outcome?: 'started' | 'pending' | 'not_started' | 'owner_returned' | 'attention' | 'unknown' };
type BriefPort = {
  identity: () => ConfigIdentity | undefined;
  available: (lease?: symbol) => boolean;
  stage: (session: string, body: string) => Promise<FeatureAdmission>;
  run: (session: string, request: RunRequest) => Promise<FeatureAdmission>;
  completionMs: number;
  pollMs: number;
};

/** Owns stage → invoke → initiation observation, never Runner execution or lifecycle. */
export class RunnerBrief {
  busy = false;
  blocked = false;
  detail: HubText = '';
  result?: BriefResult;
  private snapshot?: ControlSnapshot;
  private wake?: () => void;
  constructor(private readonly port: BriefPort, private readonly changed: () => void) {}
  observe(snapshot: ControlSnapshot) { this.snapshot = snapshot; this.wake?.(); }
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
    return same(identity, this.port.identity()) && this.snapshot?.state === 'ready'
      && supportsRun(this.snapshot.features?.run);
  }
  private async initiation(identity: ConfigIdentity, original: number, evidence: Partial<BriefResult>): Promise<BriefResult['status']> {
    // This deadline bounds missing initiation evidence, never the IssueRun lifecycle.
    const deadline = performance.now() + this.port.completionMs;
    evidence.outcome = 'pending'; this.detail = msg('brief.pending'); this.changed();
    while (this.current(identity) && performance.now() < deadline) {
      const admission = await this.port.run(identity.session,
        { operation: 'run.status', api_version: 1, invocation_request_id: original });
      evidence.statusRequest = admission;
      if (await this.receipt(identity, admission, 'run.status') !== 'completed' || admission.state !== 'submitted') return 'unknown';
      const result = this.snapshot?.features?.results.find(r => r.id === admission.id && r.operation === 'run.status');
      evidence.code = result?.code;
      const reply = result?.reply;
      if (!record(reply) || !isRunObservation(reply.run, original)) return 'unknown';
      const run = reply.run; evidence.initiation = run;
      if (run.initiation_status === 'started') { evidence.outcome = 'started'; return 'completed'; }
      if (run.initiation_status !== 'pending') {
        evidence.outcome = run.user_input_required || ['SUSPENDED', 'PAUSED', 'WAITING_FOR_HUMAN'].includes(run.owner_status)
          ? 'attention' : run.initiation_status === 'not_started' ? 'not_started'
            : run.dispatch_status === 'returned' ? 'owner_returned' : 'unknown';
        return run.initiation_status === 'not_started' ? 'rejected' : 'unknown';
      }
      await new Promise(resolve => setTimeout(resolve, this.port.pollMs));
    }
    return 'unknown';
  }
  async submit(body: string, lease?: symbol): Promise<BriefResult> {
    const identity = this.port.identity(), snapshot = this.snapshot;
    if (this.busy || this.blocked) return { brief: true, staged: false, status: 'rejected' };
    this.result = undefined;
    if (!identity || !this.port.available(lease) || snapshot?.observation?.run_mode !== 'issue-run'
      || snapshot.features?.brief?.version !== 1 || !snapshot.features.brief.operations.includes('brief.stage')
      || !supportsRun(snapshot.features.run)) {
      this.detail = msg('brief.unavailable'); this.changed();
      return this.result = { brief: true, staged: false, status: 'rejected' };
    }
    this.busy = true; this.detail = msg('brief.staging'); this.changed();
    let staged = false, status: BriefResult['status'] = 'unknown';
    let stagingRequest: FeatureAdmission | undefined, runRequest: FeatureAdmission | undefined;
    const evidence: Partial<BriefResult> = {};
    try {
      stagingRequest = await this.port.stage(identity.session, body);
      status = await this.receipt(identity, stagingRequest, 'brief.stage');
      if (status === 'completed') {
        staged = true; this.detail = msg('brief.staged'); this.changed();
        if (!this.current(identity)) status = 'unknown';
        else {
          this.detail = msg('brief.requesting'); this.changed();
          runRequest = await this.port.run(identity.session, { operation: 'run.invoke', api_version: 1 });
          status = await this.receipt(identity, runRequest, 'run.invoke');
          if (runRequest.state === 'not-sent') status = 'unknown';
          if (runRequest.state === 'submitted') {
            const original = runRequest.id;
            const result = this.snapshot?.features?.results.find(r => r.id === original && r.operation === 'run.invoke');
            evidence.code = result?.code;
            if (status === 'completed') {
              const reply = result?.reply;
              status = record(reply) && reply.receipt === 'request_accepted' && isRunObservation(reply.run, runRequest.id)
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
    return this.result;
  }
}
