import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal } from './RunnerTerminal';
import { RunnerComposer } from './RunnerComposer';
import { RunnerControls } from './RunnerControls';
import { RunnerRecovery } from './RunnerRecovery';
import { RunnerReferences } from './RunnerReferences';
import { RunnerLocation, type RunnerInstallation } from './RunnerLocation';
import type { SingleEntry } from './singleEntry';
import { SingleEntryComposer, SingleEntrySettings } from './SingleEntryComposer';

export function Workspace({ runner, session, theme, installation, onInstallation, entry, onSelectRunner }: {
  runner?: RunnerView; session?: RunnerSession; theme: 'light' | 'black';
  installation: RunnerInstallation | null; onInstallation: (value: RunnerInstallation | null) => void;
  entry: SingleEntry; onSelectRunner: (id: string) => void;
}) {
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? 'Single Entry workspace' : 'Runner workspace'}>
    <header className="workspace-header">
      <div className="context-title"><span className="eyebrow">{singleEntry ? 'STARTING POINT' : 'RUNNER WORKSPACE'}</span>
        <h1 title={runner?.name}>{runner?.name ?? 'Single Entry'}</h1></div>
      <span className="context-badge">{singleEntry ? 'Assignment defaults' : 'This Runner only'}</span>
      {session && <button type="button" className="terminate-runner" disabled={runner?.status !== 'running'}
        onClick={() => void session.terminate()}>Terminate Runner</button>}
    </header>
    {session && <RunnerRecovery session={session} />}
    {session ? <RunnerControls control={session.control} /> : singleEntry ? <SingleEntrySettings entry={entry} />
      : <section className="context-settings" aria-label="Selected Runner settings"><div className="settings-grid">
        {['Project', 'Model', 'Account', 'Mode'].map(label => <label className="setting" key={label}><span>{label}</span>
          <select aria-label={`Runner ${label}`} disabled><option>Not connected</option></select></label>)}
        <button className="command-button" type="button" disabled title="Command shortcuts are not connected">⌘ Commands</button>
      </div><p className="scope-note">Settings belong to this Runner. Single Entry defaults do not change this context.</p></section>}
    <section className="output" aria-label="Output viewport">
      <div className="output-label"><span>OUTPUT</span><span className="quiet-status" role="status">{session
        ? runner?.status === 'starting' ? 'Starting Runner process…'
          : runner?.status === 'running' ? 'Process running' : runner?.status === 'failed' ? 'Launch failed'
            : `Process exited (${runner?.exitCode ?? 'unknown'})` : 'Not connected'}</span></div>
      {runner?.detail && <p role="alert" className="runner-error">{runner.detail}</p>}
      {singleEntry && <RunnerLocation installation={installation} onChange={onInstallation} />}
      {session ? <RunnerTerminal session={session} theme={theme} /> : <div className="empty-workspace">
        <div className="workspace-symbol" aria-hidden="true">{singleEntry ? '↗' : '›_'}</div>
        <h2>{singleEntry ? 'A place to begin.' : 'Ready for a connection.'}</h2>
        <p>{singleEntry ? 'Bring your next task into focus. Runner output will live here.' : 'This Runner has no connected output stream.'}</p>
        <span className="empty-note">{singleEntry ? 'Assign below, or use New Runner for a manual session.' : 'No connected process for this preview row.'}</span>
      </div>}
    </section>
    {session && <RunnerReferences control={session.control} selection={session.references} />}
    {session ? <RunnerComposer session={session} /> : singleEntry ? <SingleEntryComposer entry={entry}
      location={installation?.root} onSelectRunner={onSelectRunner} /> : <section className="composer-area" aria-label="Instruction composer">
        <div className="composer"><textarea aria-label="Runner instructions" disabled rows={3} />
          <div className="composer-actions"><div className="attachments">
            <button disabled aria-label="Attach file">＋ <span>Attach file</span></button>
            <button disabled aria-label="Attach folder">▱ <span>Folder</span></button>
          </div><button className="send-button" disabled>Send instruction <span aria-hidden="true">↗</span></button></div>
        </div><p className="composer-note">No connected process. Attachments are unavailable.</p></section>}
  </main>;
}
