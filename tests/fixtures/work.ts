import { ConfigFixture } from './sessionConfig';
import { copy, same, type FeatureResult } from '../../src/hub/runnerConfigContract';
import { runModes, type WorkRequest, type WorkObservation } from '../../src/hub/runnerWork';

export function terminalWork(id: number, event: number, changes: Partial<WorkObservation> = {}): WorkObservation {
  return { observation_id: `terminal:${id}`, origin: 'terminal', submission_request_id: null, run_mode: 'direct-run',
    state: 'active', admission: 'admitted', work_id: { kind: 'direct_turn', id: `turn-${id}` }, execution_id: `exec-${id}`,
    event_id: event, started_event_id: event, terminal: false, outcome: 'pending', code: '', owner: 'turn', owner_revision: 0, ...changes };
}

/** Synthetic Runner contract responses; never Provider or native transport evidence. */
export class WorkFixture {
  readonly config: ConfigFixture;
  readonly requests: WorkRequest[] = [];
  mode = 'started';
  holdSubmit = false;
  fault = '';
  work?: WorkObservation;
  readonly observations = new Map<string, WorkObservation>();
  enableDiscovery(size = 2) {
    this.config.features.work = { version: 1, operations: ['work.submit', 'work.status', 'work.list', 'work.observe'],
      run_modes: [...runModes], origins: ['api', 'terminal'], max_page_size: size };
  }
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
      if (this.features.work?.origins) {
        Object.assign(this.work, { observation_id: `api:${id}`, origin: 'api',
          event_id: Math.max(0, ...[...this.observations.values()].map(w => w.event_id)) + 1 });
      }
      if (this.holdSubmit) this.held = result;
      else { result.state = 'accepted'; result.phase = 'completed'; result.reply = { receipt: 'dispatch_received', work: copy(this.work) }; }
    } else if (request.operation === 'work.status' || request.operation === 'work.observe'
      && request.observation_id === this.work?.observation_id) {
      const original = this.work?.submission_request_id;
      if (this.work && this.mode !== 'dispatch') {
        const previous = copy(this.work);
        const state = this.mode === 'started' ? 'active' : this.mode === 'admitted' ? 'instruction_admitted' : this.mode;
        const started = ['active', 'suspended', 'succeeded', 'failed', 'interrupted', 'incomplete', 'unknown'].includes(state);
        const kind = this.work.run_mode === 'task-run' ? 'task' : this.work.run_mode === 'issue-run' ? 'issue' : 'direct_turn';
        Object.assign(this.work, { state, admission: state === 'rejected' ? 'rejected' : started || state === 'instruction_admitted' ? 'admitted' : 'unknown',
          event_id: 4, started_event_id: started && state !== 'unknown' ? 3 : 0,
          work_id: started ? { kind, id: 'fixture-work' } : null,
          terminal: ['rejected', 'succeeded', 'failed', 'interrupted'].includes(state),
          outcome: ['rejected', 'succeeded', 'failed', 'interrupted', 'incomplete', 'unknown'].includes(state) ? state : 'pending',
          code: state === 'rejected' ? 'FIXTURE_REJECTED' : '' });
        this.work.started_event_id = previous.started_event_id || (started && state !== 'unknown' ? previous.event_id + 2 : 0);
        this.work.event_id = same({ ...previous, event_id: 0 }, { ...this.work, event_id: 0 })
          ? previous.event_id : previous.event_id + 3;
      }
      result.state = 'accepted'; result.phase = 'completed';
      if (this.fault === 'completion-unknown' && this.work) Object.assign(this.work, { state: 'unknown', outcome: 'unknown' });
      result.reply = (request.operation === 'work.status' ? original === request.submission_request_id
        : request.observation_id === this.work?.observation_id) ? { work: copy(this.work) }
        : { code: 'SUBMISSION_NOT_OBSERVED', outcome_unknown: true };
      if (this.fault === 'crossed' && this.work) (result.reply as { work: WorkObservation }).work.submission_request_id!++;
    } else {
      result.state = 'accepted'; result.phase = 'completed';
      if (request.operation === 'work.observe') result.reply = { work: copy(this.observations.get(request.observation_id)) };
      else {
        const changed = [...this.observations.values()].filter(w => w.event_id > request.after_event_id).sort((a, b) => a.event_id - b.event_id);
        const works = changed.slice(0, request.limit), has_more = changed.length > works.length;
        const latest_event_id = Math.max(0, ...[...this.observations.values()].map(w => w.event_id));
        result.reply = { works: copy(works), has_more, latest_event_id,
          next_after_event_id: has_more ? works.at(-1)!.event_id : latest_event_id };
      }
    }
    if (this.work?.observation_id) this.observations.set(this.work.observation_id, copy(this.work));
    this.changed();
    return { state: 'submitted' as const, id, generation: this.features.generation };
  }
  releaseSubmit() {
    if (!this.held) return;
    Object.assign(this.held, { state: 'accepted', phase: 'completed', reply: { receipt: 'dispatch_received', work: copy(this.work) } });
    this.held = undefined; this.changed();
  }
}
