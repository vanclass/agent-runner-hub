import { useHubTranslation, t } from './i18n';
import { ComposerPresentation } from './ComposerPresentation';
import type { RunnerSession } from './RunnerSessions';
import { ComposerAttachments } from './ComposerAttachments';
import { instructionKey } from './instructionKey';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting || session.control.commandPending;
  const available = !session.view.closing && session.view.status === 'running' && session.view.canSubmit
    && !session.assignmentReserved && !session.foregroundInteraction && !session.submissionUncertain;
  async function submit(briefRun = false) {
    if (session.view.submitting) return;
    try { await session.submit(briefRun); }
    catch { /* The session publishes delivery failures to the Hub log. */ }
  }
  return <ComposerPresentation text={text} compact={session.composerCompact} className="runner-composer">
    <ComposerAttachments selection={session.references} disabled={!!session.view.closing || pending || session.assignmentReserved || session.submissionUncertain}>
      <textarea data-instruction="true" aria-label={t(session.hubSelections?.defaults.runMode === 'issue-run' ? 'brief.input' : 'composer.runnerInstructions')} value={text} rows={3} disabled={!available || pending}
        onKeyDown={event => instructionKey(event, briefRun => {
          if (!briefRun || session.hubSelections?.defaults.runMode === 'issue-run') void submit(briefRun);
        })}
        placeholder={t('composer.placeholder')} onChange={event => session.setDraft(event.target.value)} />
    </ComposerAttachments>
  </ComposerPresentation>;
}
