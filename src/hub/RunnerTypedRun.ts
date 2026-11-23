import { msg, type HubText } from './i18n';
import type { ControlSnapshot } from './runnerControl';
import { record, type ConfigIdentity, type FeatureAdmission } from './runnerConfigContract';
import { isRunReceipt, type RunRequest } from './runnerRunContract';

// Match native slash-command admission when typed Run uses feature transport.
export const slashCommandMaxBytes = 4096;

type Settlement =
  | { state: 'accepted' }
  | { state: 'not-sent' | 'rejected' | 'unknown'; detail: HubText };

type Attempt = {
  identity: ConfigIdentity;
  admission?: Extract<FeatureAdmission, { state: 'submitted' }>;
  timer?: ReturnType<typeof setTimeout>;
};

export class RunnerTypedRun {
  private attempt?: Attempt;
  private delivered?: ConfigIdentity;
  private result?: Settlement;
  get settlement() { return this.result; }
  get pending() { return this.attempt !== undefined; }
  get uncertain() { return this.settlement?.state === 'unknown'; }

  constructor(
    private readonly current: () => { session?: string; snapshot: ControlSnapshot },
    private readonly invoke: (id: string, request: RunRequest) => Promise<FeatureAdmission>,
    private readonly completionMs: number,
    private readonly changed: () => void,
  ) {}

  get canEdit() {
    const { session, snapshot } = this.current();
    return this.delivered !== undefined && this.delivered.session === session
      && this.delivered.generation === snapshot.features?.generation
      && snapshot.state === 'ready' && (!snapshot.observation || snapshot.observation.run_mode === 'issue-run');
  }

  async submit(identity: ConfigIdentity, draft: string, text: string) {
    if (new TextEncoder().encode(draft).length > slashCommandMaxBytes) {
      this.finish({ state: 'not-sent',
        detail: msg('runtime.control.slashCommandTooLong', { maxBytes: slashCommandMaxBytes }) });
      return;
    }
    const attempt: Attempt = { identity };
    this.result = undefined;
    this.attempt = attempt;
    attempt.timer = setTimeout(() => this.unknown(), this.completionMs);
    this.changed();
    try {
      const admission = await this.invoke(identity.session,
        { operation: 'run.invoke', api_version: 1, ...(text.length ? { text } : {}) });
      if (this.attempt !== attempt) return;
      if (admission.state === 'not-sent') {
        this.finish({ state: 'not-sent', detail: msg('runtime.entry.unsent', { reason: admission.detail }) });
      } else if (admission.state !== 'submitted' || admission.generation !== identity.generation) {
        this.unknown();
      } else {
        attempt.admission = admission;
        this.observe();
      }
    } catch {
      if (this.attempt === attempt) this.unknown();
    }
  }

  observe() {
    const attempt = this.attempt;
    if (!attempt) return;
    const { session, snapshot } = this.current();
    if (session !== attempt.identity.session || snapshot.features?.generation !== attempt.identity.generation) {
      this.unknown();
      return;
    }
    const result = snapshot.features.results.find(result => result.id === attempt.admission?.id
      && result.feature === 'run' && result.operation === 'run.invoke');
    if (result?.state === 'not-sent') {
      this.finish({ state: 'not-sent', detail: msg('runtime.entry.unsent', { reason: result.code || '' }) });
    } else if (result?.state === 'accepted' && result.phase === 'completed' && isRunReceipt(result.reply, result.id)) {
      this.delivered = attempt.identity;
      this.finish({ state: 'accepted' });
    } else if ((result?.state === 'rejected' || result?.state === 'failure')
      && record(result.reply) && result.reply.outcome_unknown === false) {
      this.finish({ state: 'rejected', detail: msg('work.rejected', { code: result.code || '' }) });
    } else if (snapshot.state === 'disconnected' || result?.state === 'outcome-unknown'
      || result?.phase === 'completed') {
      this.unknown();
    }
  }

  private unknown() {
    this.finish({ state: 'unknown', detail: msg('runtime.session.deliveryUnknown') });
  }

  private finish(settlement: Settlement) {
    clearTimeout(this.attempt?.timer);
    this.attempt = undefined;
    this.result = settlement;
    this.changed();
  }
}
