import { useHubTranslation, t } from './i18n';
import { ComposerPresentation } from './ComposerPresentation';
import type { RunnerSession } from './RunnerSessions';
import { ComposerAttachments } from './ComposerAttachments';
import { InstructionTextarea } from './InstructionTextarea';
import { runnerAttachmentsDisabled } from './hubFileDrop';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting || session.control.commandPending || session.control.assignmentLocked
    || session.quick.interactionBusy || session.control.config.busy || !!session.hubSelections?.loadingOptions;
  const started = session.control.work.current;
  const typedRun = session.control.typedRun;
  const canDraft = session.view.canSubmit || typedRun.pending || session.typedRunCanEdit
    || !!started && started.work?.run_mode === 'issue-run'
    && session.control.work.hasConfirmedStart(started);
  const available = !session.view.closing && session.view.status === 'running' && canDraft
    && !session.assignmentReserved && !session.foregroundInteraction && !session.submissionUncertain;
  async function submit(briefRun = false) {
    if (session.view.submitting) return;
    try { await session.submit(briefRun); }
    catch { /* The session publishes delivery failures to the Hub log. */ }
  }
  return <ComposerPresentation text={text} compact={session.composerCompact} className="runner-composer">
    <ComposerAttachments selection={session.references} disabled={runnerAttachmentsDisabled(session)}>
      <InstructionTextarea key={session.view.id} aria-label={t(session.hubSelections?.defaults.runMode === 'issue-run' ? 'brief.input' : 'composer.runnerInstructions')} value={text} rows={3} disabled={!available || pending}
        readOnly={typedRun.pending} aria-busy={typedRun.pending || undefined}
        history={session.instructionHistory} edit={value => session.setDraft(value)}
        submit={briefRun => {
          if (!briefRun || session.hubSelections?.defaults.runMode === 'issue-run') void submit(briefRun);
        }}
        placeholder={t('composer.placeholder')} />
    </ComposerAttachments>
  </ComposerPresentation>;
}
