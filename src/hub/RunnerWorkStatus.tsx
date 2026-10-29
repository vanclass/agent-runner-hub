import { useState } from 'react';
import { errorText, t, tr, type HubText, type MessageKey } from './i18n';
import type { RunnerWork, WorkAttempt, WorkObservation } from './runnerWork';

const states: Record<WorkObservation['state'], MessageKey> = {
  dispatching: 'work.states.dispatching', instruction_admitted: 'work.states.instruction_admitted',
  execution_started: 'work.states.execution_started', active: 'work.states.active', suspended: 'work.states.suspended',
  incomplete: 'work.states.incomplete', succeeded: 'work.states.succeeded', failed: 'work.states.failed',
  interrupted: 'work.states.interrupted', unknown: 'work.states.unknown', rejected: 'work.states.rejected',
};
function attemptState(work: RunnerWork, attempt: WorkAttempt) {
  return attempt.uncertain ? t('work.unknown') : attempt.work ? t(states[attempt.work.state])
    : work.writing && work.current === attempt ? t(work.progress?.state === 'queued' ? 'work.queued' : 'config.sending')
      : attempt.notSent ? t('work.notSent') : t('work.unknown');
}

export function RunnerInstructions({ work }: { work: RunnerWork }) {
  const attempts = work.presentedAttempts.filter(attempt => attempt.instruction !== undefined);
  if (!attempts.length) return null;
  return <section className="runner-instructions" aria-label={t('work.instructions')}>
    {attempts.map(attempt => <article className="runner-instruction" key={work.attempts.indexOf(attempt)}>
      <pre>{attempt.instruction}</pre>
      <p>{attemptState(work, attempt)} · {attempt.work?.started_event_id
        ? t('work.startEvidence', { event: attempt.work.started_event_id }) : t('work.noStart')}</p>
    </article>)}
  </section>;
}
export function RunnerWorkStatus({ work }: { work: RunnerWork }) {
  const [error, setError] = useState<HubText>('');
  const attempt = work.presentedCurrent;
  if (!attempt) return null;
  const current = attempt.work;
  return <section className="runner-work-status" aria-label={t('work.status')}>
    <p role="status">{attemptState(work, attempt)}</p>
    <p>{current?.started_event_id ? t('work.startEvidence', { event: current.started_event_id }) : t('work.noStart')}</p>
    {current?.code && <code>{current.code}</code>}
    <button type="button" disabled={!work.supported || work.busy || current?.terminal
      || !(work.discoverySupported && attempt.observationId || attempt.submissionId)}
      onClick={() => { setError(''); void work.refreshStatus().catch(reason => setError(errorText(reason))); }}>{t('work.refresh')}</button>
    {error && <p role="alert">{tr(error)}</p>}
  </section>;
}
