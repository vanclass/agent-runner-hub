import { useHubTranslation, t, tr } from './i18n';
import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal } from './RunnerTerminal';
import { RunnerComposer } from './RunnerComposer';
import { RunnerRecovery } from './RunnerRecovery';
import { RunnerReferences } from './RunnerReferences';
import { RunnerImagePreviews } from './RunnerImagePreviews';
import type { RunnerInstallation } from './runnerInstallation';
import type { SingleEntry } from './singleEntry';
import { SingleEntryComposer } from './SingleEntryComposer';
import { RunnerTabClose } from './RunnerTabClose';

export function Workspace({ runner, session, theme, installation, entry, onSelectRunner, onCloseRunner }: {
  runner?: RunnerView; session?: RunnerSession; theme: 'light' | 'black';
  installation: RunnerInstallation | null;
  entry: SingleEntry; onSelectRunner: (id: string) => void;
  onCloseRunner: (id: string) => Promise<void>;
}) {
  useHubTranslation();
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? t('workspace.singleLabel') : t('workspace.runnerLabel')}>
    {!singleEntry && <header className="workspace-header">
      <div className="context-title"><span className="eyebrow">{t('workspace.runnerEyebrow')}</span>
        <h1 title={runner?.name}>{runner?.name ?? t('common.singleEntry')}</h1></div>
      <span className="context-badge">{t('workspace.runnerOnly')}</span>
      {session && <button type="button" className="terminate-runner" disabled={!!runner?.closing || runner?.status !== 'running'}
        onClick={() => void session.terminate()}>{t('workspace.terminate')}</button>}
      {session && <RunnerTabClose name={session.view.name} closing={!!runner?.closing}
        onClose={() => onCloseRunner(session.view.id)} />}
    </header>}
    {session && <RunnerRecovery session={session} />}
    <section className="output" aria-label={t('workspace.outputLabel')}>
      <div className="output-label"><span>{t('workspace.output')}</span><span className="quiet-status" role="status">{session
        ? runner?.status === 'starting' ? t('workspace.starting')
          : runner?.status === 'running' ? t('workspace.running') : runner?.status === 'failed' ? t('workspace.failed')
            : t('workspace.exited', { code: runner?.exitCode ?? t('common.unknown') }) : t('common.notConnected')}</span></div>
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
      <RunnerReferences control={session.control} selection={session.references} />
    </div>}
    {session ? <RunnerComposer session={session} /> : singleEntry ? <SingleEntryComposer entry={entry}
      location={installation?.root} onSelectRunner={onSelectRunner} /> : <section className="composer-area" aria-label={t('composer.label')}>
        <div className="composer"><textarea aria-label={t('composer.runnerInstructions')} disabled rows={3} />
          <div className="composer-actions"><div className="attachments">
            <button disabled aria-label={t('composer.attachFile')}>＋ <span>{t('composer.attachFile')}</span></button>
            <button disabled aria-label={t('composer.attachFolder')}>▱ <span>{t('composer.folder')}</span></button>
          </div><button className="send-button" disabled>{t('composer.send')} <span aria-hidden="true">↗</span></button></div>
        </div><p className="composer-note">{t('workspace.attachmentsUnavailable')}</p></section>}
  </main>;
}
