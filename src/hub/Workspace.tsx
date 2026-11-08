import { useHubTranslation, t, tr } from './i18n';
import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal } from './RunnerTerminal';
import { RunnerComposer } from './RunnerComposer';
import { RunnerInteractionPanel } from './RunnerInteractionPanel';
import { RunnerImagePreviews } from './RunnerImagePreviews';
import type { RunnerInstallation } from './runnerInstallation';
import type { SingleEntry } from './singleEntry';
import { SingleEntryComposer } from './SingleEntryComposer';
const recoveryKeys = {
  waiting: 'recovery.auto.waiting', recovering: 'recovery.auto.recovering', recovered: 'recovery.auto.recovered',
  absent: 'recovery.auto.absent', blocked: 'recovery.auto.blocked', identity_conflict: 'recovery.auto.identity_conflict',
  interaction_required: 'recovery.auto.interaction_required', unverified: 'recovery.auto.unverified', partial: 'recovery.auto.partial',
} as const;

export function Workspace({ runner, session, theme, installation, entry, onSelectRunner }: {
  runner?: RunnerView; session?: RunnerSession; theme: 'light' | 'black';
  installation: RunnerInstallation | null;
  entry: SingleEntry; onSelectRunner: (id: string) => void;
}) {
  useHubTranslation();
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? t('workspace.singleLabel') : t('workspace.runnerLabel')}>
    <section className="output" aria-label={t('workspace.outputLabel')}>
      <div className="output-label"><span>{t('workspace.output')}</span><span className="quiet-status" role="status">{session
        ? session.control.recovery.outcome ? t(recoveryKeys[session.control.recovery.outcome])
          : runner?.status === 'starting' ? t('workspace.starting')
          : runner?.status === 'running' ? t('workspace.running') : runner?.status === 'failed' ? t('workspace.failed')
            : t('workspace.exited', { code: runner?.exitCode ?? t('common.unknown') }) : t('common.notConnected')}
        {session?.control.recovery.outcome && session.control.recovery.saved?.code
          ? ` · ${session.control.recovery.saved.code}` : ''}</span></div>
      {runner?.detail && <p role="alert" className="runner-error">{tr(runner.detail)}</p>}
      {session ? <RunnerTerminal session={session} theme={theme} /> : !singleEntry && <div className="empty-workspace">
        <div className="workspace-symbol" aria-hidden="true">›_</div>
        <h2>{t('workspace.connection')}</h2>
        <p>{t('workspace.noStream')}</p>
        <span className="empty-note">{t('workspace.previewDisconnected')}</span>
      </div>}
    </section>
    {session && <div className="workspace-context">
      <RunnerImagePreviews images={session.control.images} />
    </div>}
    {session && !runner?.closing && <RunnerInteractionPanel key={session.view.id} interaction={session.control.interaction}
      results={session.control.snapshot.results} />}
    {session ? <RunnerComposer session={session} /> : singleEntry ? <SingleEntryComposer entry={entry}
      location={installation?.root} onSelectRunner={onSelectRunner} /> : <section className="composer-area" aria-label={t('composer.label')}>
        <div className="composer"><textarea aria-label={t('composer.runnerInstructions')} disabled rows={3} />
        </div><p className="composer-note">{t('workspace.attachmentsUnavailable')}</p></section>}
  </main>;
}
