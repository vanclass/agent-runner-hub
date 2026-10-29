import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useState } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { ComposerAttachments } from './ComposerAttachments';
import { RunnerWorkStatus } from './RunnerWorkStatus';
import { instructionKey } from './instructionKey';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting;
  const [error, setError] = useState<HubText>('');
  const available = !session.view.closing && session.view.status === 'running' && session.view.canSubmit
    && (!session.assignmentReserved || session.foregroundInteraction) && !session.submissionUncertain;
  async function submit(briefRun = false) {
    if (session.view.submitting) return;
    setError('');
    try { await session.submit(briefRun); }
    catch (reason) { setError(errorText(reason)); }
  }
  return <section className="composer-area" aria-label={t('composer.label')}>
    <RunnerWorkStatus work={session.control.work} />
    <ComposerAttachments selection={session.references} disabled={!!session.view.closing || pending || session.assignmentReserved || session.submissionUncertain}>
      <textarea data-instruction="true" aria-label={t('composer.runnerInstructions')} value={text} rows={3} disabled={!available || pending}
        onKeyDown={event => instructionKey(event, briefRun => {
          if (!briefRun || session.hubSelections?.defaults.runMode === 'issue-run') void submit(briefRun);
        })}
        placeholder={t('composer.placeholder')} onChange={event => session.setDraft(event.target.value)} />
      <div className="composer-actions"><button type="button" className="send-button" aria-label={t('composer.send')} disabled={!available || pending || !text}
        onClick={() => void submit()}>{pending ? t('composer.sending') : t('composer.send')} <span aria-hidden="true">↗</span></button></div>
    </ComposerAttachments>
    {error && <p role="alert">{tr(error)}</p>}
    {session.control.brief.detail && <p role="status">{tr(session.control.brief.detail)}</p>}
    <p className="composer-note">{pending ? t('composer.verifying')
      : session.submissionUncertain ? t('composer.uncertain')
      : session.assignmentReserved ? t('composer.reserved') : session.view.status === 'running'
      ? available ? t(session.foregroundInteraction ? 'composer.reply' : 'composer.appends')
        : t('runtime.input.waiting')
      : t('runtime.session.notRunning')}</p>
  </section>;
}
