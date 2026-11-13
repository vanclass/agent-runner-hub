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
type Source = Pick<RunnerSessions, 'subscribe' | 'getSnapshot' | 'get' | 'entry' | 'spareSnapshot' | 'workspace' | 'failures'>;
export function createHubLogCapture(log: HubLog) {
  const previous = new Map<string, string>();
  return (source: Source) => {
  const observe = (stream: string, event: HubEvent) => {
    const signature = JSON.stringify(event);
    if (previous.get(stream) === signature) return;
    previous.set(stream, signature);
    void log.record(event);
  };
  const message = (stream: string, component: string, value: HubText | undefined, runner = '', actual = 'reported') => {
    if (!value) { previous.delete(stream); return; }
    const diagnostic = code(value);
    observe(stream, { component, operation: diagnostic, runner: token(runner), target: '', expected: 'completed',
      actual, code: diagnostic, nextAction: 'inspect-operation-status' });
  };
  const refresh = () => {
    message('entry', 'assignment', source.entry.progress, source.entry.runnerId, source.entry.phase);
    message('spare', 'allocation', source.spareSnapshot.detail);
    message('workspace', 'restoration', source.workspace.issue);
    for (const view of [...source.getSnapshot(), ...source.failures]) {
      const id = view.id, session = source.get(id);
      message(`${id}:detail`, 'runner', view.detail, id);
      if (!session) continue;
      const snapshot = session.control.snapshot;
      const target = snapshot.observation?.target;
      const destination = target ? token(`${target.owner}/${target.project}`) : '';
      observe(`${id}:connection`, { component: 'connection', operation: 'observe', runner: token(id), target: destination,
        expected: 'ready', actual: snapshot.state, code: code(snapshot.detail) || snapshot.state, nextAction: 'inspect-connection' });
      const progress = session.control.config.progress;
      if (progress && (progress.operation !== 'session_config.inspect' || ['failure', 'rejected', 'not-sent', 'outcome-unknown'].includes(progress.state)))
        observe(`${id}:config:${progress.id}`, { component: 'configuration', operation: token(progress.operation), runner: token(id), target: destination,
        expected: 'completed-receipt', actual: token(progress.state), code: diagnosticCode(progress.code) || progress.state, nextAction: 'inspect-configuration-receipt' });
      const work = session.control.work.current?.work;
      if (work) observe(`${id}:work:${work.observation_id}`, { component: 'work', operation: 'observe', runner: token(id), target: destination,
        expected: 'original-work-terminal', actual: work.state, code: token(work.outcome) || work.state, nextAction: 'inspect-original-work' });
      for (const result of snapshot.results) observe(`${id}:command:${result.id}`, {
        component: 'delivery', operation: 'command', runner: token(id), target: destination, expected: 'completed-receipt',
        actual: result.state, code: diagnosticCode(result.code) || result.state, nextAction: 'inspect-command-receipt' });
    }
  };
  void log.start(); refresh();
  const stop = source.subscribe(refresh);
  // Age cleanup continues even when no event or view change occurs.
  const timer = setInterval(() => { void log.prune(); }, 3_600_000);
  return () => { stop(); clearInterval(timer); };
  };
}
