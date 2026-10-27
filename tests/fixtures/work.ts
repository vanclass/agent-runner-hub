import { ConfigFixture } from './sessionConfig';
import { copy, same, type FeatureResult } from '../../src/hub/runnerConfigContract';
import { runModes, type WorkRequest, type WorkObservation } from '../../src/hub/runnerWork';

/** Synthetic Runner contract responses; never Provider or native transport evidence. */
export class WorkFixture {
  readonly config: ConfigFixture;
  readonly requests: WorkRequest[] = [];
  mode = 'started';
  holdSubmit = false;
  fault = '';
  work?: WorkObservation;
  changed: () => void = () => {};
  private held?: FeatureResult;
  constructor(session: string, generation = 1) {
    this.config = new ConfigFixture(session, generation);
    this.config.features.work = { version: 1, operations: ['work.submit', 'work.status'], run_modes: [...runModes] };
    this.config.changed = () => this.changed();
  }
  get features() { return this.config.features; }
  async submit(request: WorkRequest) {
    this.requests.push(copy(request));
    if (this.fault === 'not-sent') return { state: 'not-sent' as const, detail: 'FIXTURE_NOT_SENT' };
    if (this.fault === 'lost-admission') throw new Error('fixture native delivery unavailable');
    const id = Math.max(1000, ...this.features.results.map(r => r.id)) + 1;
    const result: FeatureResult = { id, feature: 'work', operation: request.operation, state: 'queued', phase: 'queued', admission: 'queued' };
    this.features.results.push(result);
    if (request.operation === 'work.submit') {
      this.work = { submission_request_id: id, run_mode: this.config.current.run_mode, state: 'dispatching', admission: 'pending',
        work_id: null, execution_id: '', event_id: 1, started_event_id: 0, terminal: false, outcome: 'pending',
        code: '', owner: 'input_consumer', owner_revision: 0 };
      if (this.holdSubmit) this.held = result;
      else { result.state = 'accepted'; result.phase = 'completed'; result.reply = { receipt: 'dispatch_received', work: copy(this.work) }; }
    } else {
      const original = this.work?.submission_request_id;
      if (this.work && this.mode !== 'dispatch') {
        const previous = copy(this.work);
        const state = this.mode === 'started' ? 'active' : this.mode === 'admitted' ? 'instruction_admitted' : this.mode;
        const started = ['active', 'suspended', 'succeeded', 'incomplete', 'unknown'].includes(state);
        Object.assign(this.work, { state, admission: state === 'rejected' ? 'rejected' : started || state === 'instruction_admitted' ? 'admitted' : 'unknown',
          event_id: 4, started_event_id: started && state !== 'unknown' ? 3 : 0,
          work_id: started ? { kind: 'direct_turn', id: 'fixture-work' } : null,
          terminal: ['rejected', 'succeeded'].includes(state),
          outcome: ['rejected', 'succeeded', 'incomplete', 'unknown'].includes(state) ? state : 'pending',
          code: state === 'rejected' ? 'FIXTURE_REJECTED' : '' });
        this.work.started_event_id = previous.started_event_id || (started && state !== 'unknown' ? previous.event_id + 2 : 0);
        this.work.event_id = same({ ...previous, event_id: 0 }, { ...this.work, event_id: 0 })
          ? previous.event_id : previous.event_id + 3;
      }
      result.state = 'accepted'; result.phase = 'completed';
      if (this.fault === 'completion-unknown' && this.work) Object.assign(this.work, { state: 'unknown', outcome: 'unknown' });
      result.reply = original === request.submission_request_id ? { work: copy(this.work) }
        : { code: 'SUBMISSION_NOT_OBSERVED', outcome_unknown: true };
      if (this.fault === 'crossed' && this.work) (result.reply as { work: WorkObservation }).work.submission_request_id++;
    }
    this.changed();
    return { state: 'submitted' as const, id, generation: this.features.generation };
  }
  releaseSubmit() {
    if (!this.held) return;
    Object.assign(this.held, { state: 'accepted', phase: 'completed', reply: { receipt: 'dispatch_received', work: copy(this.work) } });
    this.held = undefined; this.changed();
  }
}
