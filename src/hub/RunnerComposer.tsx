import { useHubTranslation, t } from './i18n';
import { useLayoutEffect, useRef } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { ComposerAttachments } from './ComposerAttachments';
import { RunnerWorkStatus } from './RunnerWorkStatus';
import { instructionKey } from './instructionKey';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting || session.control.commandPending;
  const host = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const slot = host.current!, content = slot.firstElementChild as HTMLElement;
    const input = content.querySelector('textarea')!, workspace = slot.closest('.workspace')!;
    const fit = () => {
      const style = getComputedStyle(input);
      const base = parseFloat(style.lineHeight) * input.rows + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const limit = Math.max(base, workspace.clientHeight - parseFloat(getComputedStyle(slot).getPropertyValue('--composer-top-gap')));
      input.style.height = '0px';
      const chrome = content.scrollHeight - input.offsetHeight;
      const height = Math.min(Math.max(base, input.scrollHeight), Math.max(base, limit - chrome));
      input.style.height = `${height}px`;
      slot.style.height = `${Math.min(limit, chrome + base)}px`;
      content.style.maxHeight = `${limit}px`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(workspace); resize.observe(content);
    return () => resize.disconnect();
  }, [text, session]);
  const available = !session.view.closing && session.view.status === 'running' && session.view.canSubmit
    && !session.assignmentReserved && !session.foregroundInteraction && !session.submissionUncertain;
  async function submit(briefRun = false) {
    if (session.view.submitting) return;
    try { await session.submit(briefRun); }
    catch { /* The session publishes delivery failures to the Hub log. */ }
  }
  return <section ref={host} className="composer-area runner-composer" aria-label={t('composer.label')}>
    <div className="runner-composer-content">
    <RunnerWorkStatus work={session.control.work} />
    <ComposerAttachments selection={session.references} disabled={!!session.view.closing || pending || session.assignmentReserved || session.submissionUncertain}>
      <textarea data-instruction="true" aria-label={t(session.hubSelections?.defaults.runMode === 'issue-run' ? 'brief.input' : 'composer.runnerInstructions')} value={text} rows={3} disabled={!available || pending}
        onKeyDown={event => instructionKey(event, briefRun => {
          if (!briefRun || session.hubSelections?.defaults.runMode === 'issue-run') void submit(briefRun);
        })}
        placeholder={t('composer.placeholder')} onChange={event => session.setDraft(event.target.value)} />
    </ComposerAttachments>
    </div>
  </section>;
}
