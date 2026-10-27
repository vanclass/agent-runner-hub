import { RunnerConfigService } from '../../src/hub/RunnerConfigService';
import { copy, same, type ConfigRequest, type ConfigInspect, type ConfigDesired,
  type FeatureSnapshot, type FeatureResult, type ConfigPlan } from '../../src/hub/runnerConfigContract';

/** Synthetic Runner responses; native/public Runner acceptance is separate. */
export class ConfigFixture {
  readonly session: string;
  readonly features: FeatureSnapshot;
  readonly requests: ConfigRequest[] = [];
  readonly accounts = [{ agent_id: 'codex', profile_name: 'first' }, { agent_id: 'codex', profile_name: 'second' },
    { agent_id: 'other', profile_name: 'first' }];
  current = { target: 'workspace', account: this.accounts[0], model: { id: 'm0', reasoning_effort: 'medium' },
    service_tier: 'default', run_mode: 'task-run', root: '' };
  revision = 'a'.repeat(64);
  hold = false;
  holdOperation = '';
  fault = '';
  applyOutcome = '';
  planStatus = 'ready';
  postApplyFailure = false;
  private applied = false;
  private sequence = 1000;
  private pending: { request: ConfigRequest; result: FeatureResult }[] = [];
  changed: () => void = () => {};
  constructor(session = 'fixture-a', generation = 1, guarded = true) {
    this.session = session;
    this.features = { generation, sessionConfig: { version: 1,
      operations: ['session_config.inspect', 'session_config.plan', 'session_config.apply'],
      options_page_size: 2, options_revision: guarded }, results: [] };
  }
  inspection(account = this.current.account, offset = 0): ConfigInspect {
    const models = Array.from({ length: 5 }, (_, i) => ({ id: `${account.profile_name === 'second' ? 's' : 'm'}${i}`,
      reasoning_efforts: ['medium', 'high'], service_tiers: i % 2 ? ['default'] : ['default', 'fast'] }));
    const targets = [{ id: 'workspace', owner: 'Workspace', project: '' }, { id: 'project:Exact', owner: 'Project', project: 'Exact' }];
    const options = { targets: targets.slice(offset, offset + 2), accounts: this.accounts.slice(offset, offset + 2),
      models: models.slice(offset, offset + 2), run_modes: ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'] };
    return { api_version: 1, revision: this.revision, options_revision: 'b'.repeat(64), current: copy(this.current),
      effective: { account: this.current.account.profile_name, model: 'running-model', reasoning_effort: 'medium', service_tier: 'default',
        source: 'execution', next_model: this.current.model.id, next_reasoning_effort: this.current.model.reasoning_effort,
        next_service_tier: this.current.service_tier }, runner_kind: 'existing', setup_required: false,
      availability: { target: true, account: true, model: true, service_tier: true, run_mode: true }, constraints: [],
      root_requirements: { 'direct-run': 'readable_absolute_directory' }, model_catalog_status: 'available',
      model_options_account: copy(account), options, options_page: { offset, totals: { targets: targets.length,
        accounts: this.accounts.length, models: models.length }, next_offset: offset + 2 < models.length ? offset + 2 : null } };
  }
  plan(desired: ConfigDesired): ConfigPlan {
    const changes = Object.fromEntries(Object.entries(desired).filter(([key, value]) => !same(this.current[key as keyof typeof this.current], value))
      .map(([key, value]) => [key, { from: this.current[key as keyof typeof this.current], to: value }]));
    const steps = ['account', 'model', 'service_tier', 'run_mode', 'target'].filter(k => k in changes || k === 'run_mode' && 'root' in changes);
    return { api_version: 1, desired: copy(desired), revision: this.revision, changes, steps: steps as ConfigPlan['steps'], atomic: false,
      errors: this.planStatus === 'invalid' ? ['CONFIG_MODEL_INVALID'] : [],
      required_confirmations: this.planStatus === 'confirmation_required' ? ['release_context_in_runner_terminal'] : [],
      impact: { existing_work: 'preserved', execution_settings: 'next_execution' }, plan_status: this.planStatus as ConfigPlan['plan_status'],
      ...(this.planStatus === 'ready' ? { plan_id: 'c'.repeat(64) } : {}) };
  }
  async submit(session: string, request: ConfigRequest) {
    if (session !== this.session) throw new Error('foreign session');
    this.requests.push(copy(request));
    const result: FeatureResult = { id: ++this.sequence, feature: 'session_config', operation: request.operation,
      state: 'queued', phase: 'queued', admission: 'queued' };
    this.features.results.push(result);
    this.pending.push({ request: copy(request), result });
    this.changed();
    if (!this.hold && this.holdOperation !== request.operation) setTimeout(() => this.complete(), 0);
    return { state: 'submitted' as const, id: result.id, generation: this.features.generation };
  }
  complete() {
    const item = this.pending.shift();
    if (!item) return;
    const { request, result } = item;
    result.phase = 'completed'; result.state = 'accepted';
    if (request.operation === 'session_config.inspect') {
      if (this.applied && this.postApplyFailure) { result.state = 'failure'; result.code = 'CONFIG_INSPECTION_FAILED'; result.reply = { api_version: 1 }; }
      else {
        const page = this.inspection(request.account, request.offset);
        if (request.offset && this.fault) {
          if (this.fault === 'token') page.options_revision = 'd'.repeat(64);
          if (this.fault === 'revision') page.revision = 'd'.repeat(64);
          if (this.fault === 'totals') page.options_page.totals.models++;
          if (this.fault === 'account') page.model_options_account = this.accounts[2];
          if (this.fault === 'offset') page.options_page.offset = 0;
          if (this.fault === 'next') page.options_page.next_offset = request.offset;
          if (this.fault === 'duplicate') page.options.models[0] = this.inspection(request.account).options.models[0];
          if (this.fault === 'unavailable') page.model_catalog_status = 'unavailable';
          if (this.fault === 'short') page.options.models.pop();
          if (this.fault === 'missing') { result.state = 'failure'; result.code = 'CONFIG_STATE_CHANGED'; }
        }
        result.reply = page;
      }
    } else if (request.operation === 'session_config.plan') {
      result.reply = this.plan(request.desired);
      if (this.planStatus !== 'ready') result.state = 'rejected';
    } else {
      const plan = this.plan(request.desired);
      if (request.revision !== this.revision || request.plan_id !== 'c'.repeat(64)) {
        result.state = 'rejected'; result.code = 'CONFIG_REVISION_STALE'; result.reply = { api_version: 1, atomic: false,
          apply_status: 'rejected', results: [], outcome_unknown: false, code: result.code };
      } else {
        const results = plan.steps.map((setting, index) => {
          const outcome = this.applyOutcome && (this.applyOutcome === 'partial' ? index === 1 : index === 0)
            ? this.applyOutcome === 'partial' ? 'failed' : this.applyOutcome : undefined;
          const stopped = this.applyOutcome && index > (this.applyOutcome === 'partial' ? 1 : 0);
          if (outcome || stopped) return { setting, outcome: stopped ? 'not_attempted' : outcome };
          const committed = setting === 'run_mode' ? { run_mode: request.desired.run_mode ?? this.current.run_mode,
            root: request.desired.root ?? this.current.root } : { [setting]: request.desired[setting] };
          this.current = { ...this.current, ...committed };
          return { setting, outcome: 'success', owner_status: 'SUCCESS', committed };
        });
        this.revision = 'e'.repeat(64); this.applied = true;
        result.state = this.applyOutcome ? this.applyOutcome === 'unknown' ? 'outcome-unknown' : 'failure' : 'accepted';
        result.reply = { api_version: 1, apply_status: this.applyOutcome || 'applied', atomic: false,
          results, outcome_unknown: this.applyOutcome === 'unknown', revision: this.revision, current: copy(this.current) };
      }
    }
    this.changed();
  }
}

export function createConfigHarness(session = 'fixture-a', generation = 1, guarded = true) {
  const fixture = new ConfigFixture(session, generation, guarded);
  const identity = { session, generation };
  const service = new RunnerConfigService({ identity: () => identity, available: () => true,
    submit: (session, request) => fixture.submit(session, request) }, () => {});
  fixture.changed = () => service.observe(session, 'ready', copy(fixture.features));
  fixture.changed();
  return { fixture, service, identity };
}

export async function attachConfigToHub() {
  const native = (window as any).__nativeFixture;
  const original = (window as any).__TAURI_INTERNALS__.invoke;
  const fixtures = new Map<string, ConfigFixture>();
  for (const [id, session] of native.sessions) {
    const fixture = new ConfigFixture(id, fixtures.size + 1);
    session.control.features = fixture.features;
    fixtures.set(id, fixture);
  }
  (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'runner_feature'
    ? fixtures.get(args.id)!.submit(args.id, args.request.request) : original(command, args);
  (window as any).__configFixtures = fixtures;
}
