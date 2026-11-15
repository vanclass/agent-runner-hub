import type { HubText } from './i18n';
import type { RunnerSessions } from './RunnerSessions';
import type { HubEvent, HubLog } from './HubLog';

const token = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.:/ -]{1,256}$/.test(value) ? value : '';
const diagnosticCode = (value: unknown) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(value) ? value : '';
// Raw error text, translated interpolation, instructions, account and file data never cross this projection.
function code(value: HubText | undefined): string {
  if (!value || typeof value === 'string') return value ? 'DETAIL_REDACTED' : '';
  const nested = Object.values(value.values ?? {}).filter(item => item && typeof item === 'object') as HubText[];
  return [value.key, diagnosticCode(value.values?.code), ...nested.map(code)].filter(Boolean).join('/').slice(0, 256);
}
type Source = Pick<RunnerSessions, 'subscribe' | 'subscribeLifecycle' | 'getSnapshot' | 'get' | 'getFailure' | 'failures'>;
export function createHubLogCapture(log: HubLog) {
  const previous = new Map<string, string>();
  const seen = new Set<string>();
  const instances = new WeakMap<object, number>();
  let nextInstance = 0;
  const identity = (value: object) => {
    if (!instances.has(value)) instances.set(value, ++nextInstance);
    return instances.get(value)!;
  };
  return (source: Source) => {
  const observe = (stream: string, event: HubEvent) => {
    const signature = JSON.stringify(event);
    if (previous.get(stream) === signature) return;
    previous.set(stream, signature);
    void log.record(event);
  };
  const once = (stream: string, event: HubEvent) => {
    if (seen.has(stream)) return;
    seen.add(stream);
    void log.record(event);
  };
  const refresh = () => {
    for (const view of [...source.getSnapshot(), ...source.failures]) {
      const id = view.id, session = source.get(id) ?? source.getFailure(id);
      if (!session) continue;
      const instance = identity(session), runner = token(view.name);
      const event = (component: string, operation: string, actual: string, diagnostic = actual): HubEvent => ({
        component, operation, runner, target: destination, expected: 'confirmed-outcome', actual,
        code: diagnostic, nextAction: 'inspect-operation-status' });
      const snapshot = session.control.snapshot;
      const target = snapshot.observation?.target;
      const destination = target ? token(`${target.owner}/${target.project}`) : '';
      if (['running', 'failed', 'exited'].includes(view.status))
        once(`${instance}:lifetime:${view.status}`, event('system', 'runner-lifecycle', view.status, code(view.detail) || view.status));
      if (snapshot.state !== 'connecting') observe(`${instance}:connection`,
        event('system', 'connection', snapshot.state, code(snapshot.detail) || snapshot.state));
      for (const application of session.control.config.applications) {
        const receipt = application.receipt;
        const outcome = application.result?.outcome_unknown ? 'unknown' : application.result?.apply_status
          ?? (['rejected', 'failure', 'not-sent'].includes(receipt.state) ? receipt.state : 'unknown');
        once(`${instance}:apply:${identity(application)}:${outcome}`, event('settings', 'configuration-apply', outcome,
          diagnosticCode(receipt.code) || outcome));
      }
      for (const attempt of session.control.work.attempts) {
        const work = attempt.work, key = `${instance}:work:${identity(attempt)}`;
        if (work) {
          if (work.admission === 'admitted') once(`${key}:admitted`, event('task', 'work-admitted', 'admitted'));
          if (work.started_event_id > 0) once(`${key}:started`, event('task', 'work-started', 'started'));
          if (work.terminal || ['unknown', 'incomplete', 'interrupted', 'rejected'].includes(work.state))
            once(`${key}:${work.state}:${work.outcome}`, event('task', 'work-outcome', work.state, token(work.outcome)));
        } else if (attempt.submission && ['rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(attempt.submission.state)) {
          const receipt = attempt.submission;
          once(`${key}:${receipt.state}`, event('task', 'work-submission', receipt.state, diagnosticCode(receipt.code) || receipt.state));
        }
      }
    }
  };
  const stopLifecycle = source.subscribeLifecycle(event => {
    void log.record({ component: 'system', operation: event.operation, runner: token(event.runner), target: '',
      expected: 'confirmed-outcome', actual: event.operation.endsWith('failed') ? 'failed' : 'succeeded',
      code: code(event.detail) || event.operation, nextAction: 'inspect-runner-status' });
  });
  void log.start(); refresh();
  const stop = source.subscribe(refresh);
  // Age cleanup continues even when no event or view change occurs.
  const timer = setInterval(() => { void log.prune(); }, 3_600_000);
  return () => { stop(); stopLifecycle(); clearInterval(timer); };
  };
}
