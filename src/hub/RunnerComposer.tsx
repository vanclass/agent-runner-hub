import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useState } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed } from './runnerControl';
import { RunnerWorkStatus } from './RunnerWorkStatus';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting;
  const [error, setError] = useState<HubText>('');
  const available = session.view.status === 'running' && session.view.canSubmit && !session.assignmentReserved && !session.submissionUncertain;
  const files = commandNamed(session.control.snapshot, '/files');
  const canSelect = session.references.available;
  async function pick(folder: boolean) {
    setError('');
    try { await session.references.choose(folder); }
    catch (reason) { setError(errorText(reason)); }
  }
  async function submit() {
    setError('');
    try { await session.submit(); }
    catch (reason) { setError(errorText(reason)); }
  }
  return <section className="composer-area" aria-label={t('composer.label')}>
    <RunnerWorkStatus work={session.control.work} />
    <div className="composer">
      <textarea aria-label={t('composer.runnerInstructions')} value={text} rows={3} disabled={!available || pending}
        placeholder={t('composer.placeholder')} onChange={event => session.setDraft(event.target.value)} />
      <div className="composer-actions"><div className="attachments">
        <button type="button" disabled={!canSelect} aria-label={t('composer.attachFile')} title={files?.disabled_reason || t('composer.chooseFiles')}
          onClick={() => void pick(false)}>＋ <span>{t('composer.attachFile')}</span></button>
        <button type="button" disabled={!canSelect} aria-label={t('composer.attachFolder')} title={files?.disabled_reason || t('composer.chooseFolder')}
          onClick={() => void pick(true)}>▱ <span>{t('composer.folder')}</span></button>
      </div><button type="button" className="send-button" aria-label={t('composer.send')} disabled={!available || pending || !text}
        onClick={() => void submit()}>{pending ? t('composer.sending') : t('composer.send')} <span aria-hidden="true">↗</span></button></div>
    </div>
    {error && <p role="alert">{tr(error)}</p>}
    <p className="composer-note">{pending ? t('composer.verifying')
      : session.submissionUncertain ? t('composer.uncertain')
      : session.assignmentReserved ? t('composer.reserved') : session.view.status === 'running'
      ? available ? t('composer.appends')
        : t('runtime.input.waiting')
      : t('runtime.session.notRunning')}</p>
  </section>;
}
