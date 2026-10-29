import { msg, type HubText } from './i18n';
import { record, same, type ConfigIdentity, type FeatureAdmission } from './runnerConfigContract';
import type { ControlSnapshot } from './runnerControl';

export type BriefResult = { brief: true; staged: boolean; status: 'completed' | 'rejected' | 'unknown';
  identity?: ConfigIdentity; stagingRequest?: FeatureAdmission; runRequest?: FeatureAdmission };
type BriefPort = {
  identity: () => ConfigIdentity | undefined;
  available: (lease?: symbol) => boolean;
  stage: (session: string, body: string) => Promise<FeatureAdmission>;
  run: (session: string) => Promise<FeatureAdmission>;
  completionMs: number;
};

/** Owns only the independent stage → command sequence, never Runner execution. */
export class RunnerBrief {
  busy = false;
  blocked = false;
  detail: HubText = '';
  result?: BriefResult;
  private snapshot?: ControlSnapshot;
  private wake?: () => void;
  constructor(private readonly port: BriefPort, private readonly changed: () => void) {}
  observe(snapshot: ControlSnapshot) { this.snapshot = snapshot; this.wake?.(); }
  private async receipt(identity: ConfigIdentity, admission: FeatureAdmission, stage: boolean) {
    if (admission.state !== 'submitted') return admission.state === 'not-sent' ? 'rejected' : 'unknown';
    if (admission.generation !== identity.generation) return 'unknown';
    return new Promise<'completed' | 'rejected' | 'unknown'>(resolve => {
      const finish = (state: 'completed' | 'rejected' | 'unknown') => {
        clearTimeout(timer); this.wake = undefined; resolve(state);
      };
      const timer = setTimeout(() => finish('unknown'), this.port.completionMs);
      this.wake = () => {
        const snapshot = this.snapshot;
        if (!same(identity, this.port.identity()) || snapshot?.state !== 'ready') { finish('unknown'); return; }
        const result = stage ? snapshot.features?.results.find(r => r.id === admission.id
          && r.feature === 'brief' && r.operation === 'brief.stage')
          : snapshot.results.find(r => r.id === admission.id && r.command === '/run');
        if (!result) return;
        if (result.state === 'outcome-unknown') { finish('unknown'); return; }
        if (result.state === 'not-sent' || result.state === 'rejected' || result.state === 'failure') {
          finish('rejected'); return;
        }
        if (result.state !== 'accepted' || result.phase !== 'completed') return;
        if (stage) {
          const reply = 'reply' in result ? result.reply : undefined;
          finish(record(reply) && reply.staging_status === 'staged' && reply.owner === 'brief_staging'
            && Number.isSafeInteger(reply.count) && Number(reply.count) > 0 && reply.outcome_unknown === false
            ? 'completed' : 'unknown');
        } else finish('ownerStatus' in result && result.ownerStatus === 'SUCCESS' ? 'completed' : 'unknown');
      };
      this.wake();
    });
  }
  async submit(body: string, lease?: symbol): Promise<BriefResult> {
    const identity = this.port.identity(), snapshot = this.snapshot;
    if (this.busy || this.blocked) return { brief: true, staged: false, status: 'rejected' };
    this.result = undefined;
    if (!identity || !this.port.available(lease) || snapshot?.observation?.run_mode !== 'issue-run'
      || snapshot.features?.brief?.version !== 1 || !snapshot.features.brief.operations.includes('brief.stage')) {
      this.detail = msg('brief.unavailable'); this.changed();
      return this.result = { brief: true, staged: false, status: 'rejected' };
    }
    this.busy = true; this.detail = msg('brief.staging'); this.changed();
    let staged = false, status: BriefResult['status'] = 'unknown';
    let stagingRequest: FeatureAdmission | undefined, runRequest: FeatureAdmission | undefined;
    try {
      stagingRequest = await this.port.stage(identity.session, body);
      status = await this.receipt(identity, stagingRequest, true);
      if (status === 'completed') {
        staged = true; this.detail = msg('brief.staged'); this.changed();
        if (!same(identity, this.port.identity()) || this.snapshot?.state !== 'ready') status = 'unknown';
        else {
          this.detail = msg('brief.requesting'); this.changed();
          runRequest = await this.port.run(identity.session);
          status = await this.receipt(identity, runRequest, false);
        }
      }
    } catch { status = 'unknown'; }
    finally { this.busy = false; }
    this.blocked = staged && status !== 'completed' || status === 'unknown';
    this.detail = msg(status === 'completed' ? 'brief.requested' : status === 'unknown'
      ? staged ? 'brief.runUnknown' : 'brief.stageUnknown' : staged ? 'brief.runRejected' : 'brief.stageRejected');
    this.result = { brief: true, staged, status, identity, stagingRequest, runRequest }; this.changed();
    return this.result;
  }
}
