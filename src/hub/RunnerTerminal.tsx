import { useHubTranslation, t } from './i18n';
import { useEffect, useRef } from 'react';
import type { RunnerSession } from './RunnerSessions';

export type FailureActions = { retry: () => void; dismiss: () => void };

export function RunnerTerminal({ session, failureActions }: {
  session: RunnerSession; failureActions?: FailureActions;
}) {
  const { tr } = useHubTranslation();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) return session.attach(host.current);
  }, [session]);
  const diagnostics = session.diagnostics;
  return <section className="runner-terminal" aria-label={t('terminal.label')}>
    {session.view.status === 'exited' && session.view.exitCode === 0 && !session.view.detail
      && <div className="runner-output-status" role="status">{t('lifecycle.normalExit')}</div>}
    {diagnostics.length > 0 && <div className="runner-output-diagnostics">
      {diagnostics.map((diagnostic, index) =>
        <div className="runner-output-diagnostic" role="alert" key={index}>{tr(diagnostic)}</div>)}
    </div>}
    {failureActions && <div className="tab-close-actions">
      {session.canRetryTermination && <button type="button" onClick={failureActions.retry}>
        {t('lifecycle.retryTermination')}
      </button>}
      <button type="button" title={t('lifecycle.dismissHelp')} onClick={failureActions.dismiss}>
        {t('lifecycle.dismissLog')}
      </button>
    </div>}
    <div className="terminal-host" ref={host} />
  </section>;
}
