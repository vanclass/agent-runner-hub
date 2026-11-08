import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { ComposerAttachments } from './ComposerAttachments';
import { RunnerWorkStatus } from './RunnerWorkStatus';
import { instructionKey } from './instructionKey';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting || session.control.commandPending;
  const [error, setError] = useState<HubText>('');
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
  }, [text, error, session]);
  const available = !session.view.closing && session.view.status === 'running' && session.view.canSubmit
    && !session.assignmentReserved && !session.foregroundInteraction && !session.submissionUncertain;
  async function submit(briefRun = false) {
    if (session.view.submitting) return;
    setError('');
    try { await session.submit(briefRun); }
    catch (reason) { setError(errorText(reason)); }
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
      {session.hubSelections?.defaults.runMode === 'issue-run' && <textarea aria-label={t('brief.runInput')} rows={2}
        value={session.runDraft} disabled={!available || pending} placeholder={t('brief.runInput')}
        onChange={event => session.setRunDraft(event.target.value)}
        onKeyDown={event => instructionKey(event, briefRun => { void submit(briefRun); })} />}
    </ComposerAttachments>
    {error && <p role="alert">{tr(error)}</p>}
    {session.view.detail && <p role="status">{tr(session.view.detail)}</p>}
    {session.control.brief.detail && <p role="status">{tr(session.control.brief.detail)}</p>}
    <p className="composer-note">{pending ? t('composer.verifying')
      : session.submissionUncertain ? t('composer.uncertain')
      : session.assignmentReserved ? t('composer.reserved') : session.view.status === 'running'
      ? available ? t('composer.appends')
        : t('runtime.input.waiting')
      : t('runtime.session.notRunning')}</p>
    </div>
  </section>;
}
