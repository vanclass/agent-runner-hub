import type { FeatureSnapshot, FeatureResult } from '../../src/hub/runnerConfigContract';
import type { RunRequest, RunObservation } from '../../src/hub/runnerRunContract';

/** Synthetic wire results for production Hub components, not authenticated-pipe evidence. */
export class RunFixture {
  requests: RunRequest[] = [];
  mode: string;
  run?: RunObservation;
  constructor(private features: FeatureSnapshot, mode = 'started') {
    this.mode = mode;
    if (mode !== 'unsupported') features.run = { version: 1, operations: ['run.invoke', 'run.status'] };
  }
  async submit(request: RunRequest) {
    this.requests.push(structuredClone(request));
    if (this.mode === 'lost-admission') throw new Error('Run admission receipt lost');
    const id = Math.max(8000, ...this.features.results.map(r => r.id)) + 1;
    const result: FeatureResult = { id, feature: 'run', operation: request.operation, admission: 'queued',
      state: 'accepted', phase: 'completed' };
    if (request.operation === 'run.invoke') {
      this.run = { invocation_request_id: id, request_status: 'accepted', initiation_status: 'pending',
        dispatch_status: 'dispatching', issue_run_id: '', authority_digest: '', state_revision: 0,
        lifecycle_status: '', lifecycle_terminal: false, terminal_reason: '', outcome: '', owner_status: '', outcome_unknown: false };
      result.reply = { receipt: 'request_accepted', run: structuredClone(this.run) };
      if (['rejected', 'outcome-unknown'].includes(this.mode)) {
        result.state = this.mode as FeatureResult['state'];
        result.reply = { code: 'RUN_UNAVAILABLE', outcome_unknown: this.mode === 'outcome-unknown' };
      }
    } else {
      const run = structuredClone(this.run!);
      if (this.mode === 'started') Object.assign(run, { initiation_status: 'started', issue_run_id: 'issue-fixture',
        authority_digest: 'a'.repeat(64), state_revision: 1, lifecycle_status: 'running' });
      if (['human', 'paused', 'not-started'].includes(this.mode)) Object.assign(run, { initiation_status: 'not_started',
        dispatch_status: 'returned', owner_status: this.mode === 'human' ? 'WAITING_FOR_HUMAN' : this.mode === 'paused' ? 'PAUSED' : 'REJECTED',
        user_input_required: this.mode === 'human' });
      if (this.mode === 'returned') Object.assign(run, { initiation_status: 'unknown', dispatch_status: 'returned', outcome_unknown: true, owner_status: 'SUCCESS' });
      if (this.mode === 'crossed') run.invocation_request_id++;
      if (this.mode === 'malformed') Object.assign(run, { initiation_status: 'started' });
      result.reply = { run };
    }
    this.features.results = this.features.results.filter(r => r.operation !== 'run.status');
    this.features.results.push(result);
    return { state: 'submitted' as const, id, generation: this.features.generation };
  }
}
