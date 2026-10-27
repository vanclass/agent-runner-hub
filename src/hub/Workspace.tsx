import { useHubTranslation, t, tr } from './i18n';
import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal } from './RunnerTerminal';
import { RunnerComposer } from './RunnerComposer';
import { RunnerControls } from './RunnerControls';
import { RunnerRecovery } from './RunnerRecovery';
import { RunnerReferences } from './RunnerReferences';
import { RunnerImagePreviews } from './RunnerImagePreviews';
import { RunnerLocation, type RunnerInstallation } from './RunnerLocation';
import type { SingleEntry } from './singleEntry';
import { SingleEntryComposer, SingleEntrySettings } from './SingleEntryComposer';

export function Workspace({ runner, session, theme, installation, onInstallation, entry, onSelectRunner }: {
  runner?: RunnerView; session?: RunnerSession; theme: 'light' | 'black';
  installation: RunnerInstallation | null; onInstallation: (value: RunnerInstallation | null) => void;
  entry: SingleEntry; onSelectRunner: (id: string) => void;
}) {
  useHubTranslation();
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? t('workspace.singleLabel') : t('workspace.runnerLabel')}>
    <header className="workspace-header">
      <div className="context-title"><span className="eyebrow">{singleEntry ? t('workspace.startingPoint') : t('workspace.runnerEyebrow')}</span>
        <h1 title={runner?.name}>{runner?.name ?? t('common.singleEntry')}</h1></div>
      <span className="context-badge">{singleEntry ? t('workspace.defaults') : t('workspace.runnerOnly')}</span>
      {session && <button type="button" className="terminate-runner" disabled={runner?.status !== 'running'}
        onClick={() => void session.terminate()}>{t('workspace.terminate')}</button>}
    </header>
    {session && <RunnerRecovery session={session} />}
    {session ? <RunnerControls control={session.control} /> : singleEntry ? <SingleEntrySettings entry={entry} />
      : <section className="context-settings" aria-label={t('control.settings')}><div className="settings-grid">
        {[t('fields.project'), t('fields.model'), t('fields.account'), t('fields.mode')].map(label => <label className="setting" key={label}><span>{label}</span>
          <select aria-label={t('control.runnerField', { field: label })} disabled><option>{t('common.notConnected')}</option></select></label>)}
        <button className="command-button" type="button" disabled title={t('workspace.commandsUnavailable')}>{t('workspace.commands')}</button>
      </div><p className="scope-note">{t('workspace.scope')}</p></section>}
    <section className="output" aria-label={t('workspace.outputLabel')}>
      <div className="output-label"><span>{t('workspace.output')}</span><span className="quiet-status" role="status">{session
        ? runner?.status === 'starting' ? t('workspace.starting')
          : runner?.status === 'running' ? t('workspace.running') : runner?.status === 'failed' ? t('workspace.failed')
            : t('workspace.exited', { code: runner?.exitCode ?? t('common.unknown') }) : t('common.notConnected')}</span></div>
      {runner?.detail && <p role="alert" className="runner-error">{tr(runner.detail)}</p>}
      {singleEntry && <RunnerLocation installation={installation} onChange={onInstallation} />}
      {session ? <RunnerTerminal session={session} theme={theme} /> : <div className="empty-workspace">
        <div className="workspace-symbol" aria-hidden="true">{singleEntry ? '↗' : '›_'}</div>
        <h2>{singleEntry ? t('workspace.begin') : t('workspace.connection')}</h2>
        <p>{singleEntry ? t('workspace.beginDescription') : t('workspace.noStream')}</p>
        <span className="empty-note">{singleEntry ? t('workspace.assignHint') : t('workspace.previewDisconnected')}</span>
      </div>}
    </section>
    {session && <RunnerImagePreviews images={session.control.images} />}
    {session && <RunnerReferences control={session.control} selection={session.references} />}
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
