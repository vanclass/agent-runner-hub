import type { RunnerView } from './model';
import type { RunnerSession } from './RunnerSessions';
import { RunnerTerminal } from './RunnerTerminal';
import { RunnerComposer } from './RunnerComposer';
import { RunnerControls } from './RunnerControls';
import { RunnerReferences } from './RunnerReferences';
import { RunnerLocation, type RunnerInstallation } from './RunnerLocation';

export function Workspace({ runner, session, theme, installation, onInstallation, onCreate, launching }: {
  runner?: RunnerView; session?: RunnerSession; theme: 'light' | 'black';
  installation: RunnerInstallation | null; onInstallation: (value: RunnerInstallation | null) => void;
  onCreate: () => void; launching: boolean;
}) {
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? 'Single Entry workspace' : 'Runner workspace'}>
    <header className="workspace-header">
      <div className="context-title"><span className="eyebrow">{singleEntry ? 'STARTING POINT' : 'RUNNER WORKSPACE'}</span>
        <h1 title={runner?.name}>{runner?.name ?? 'Single Entry'}</h1></div>
      <span className="context-badge">{singleEntry ? 'New Runner defaults' : 'This Runner only'}</span>
      {session && <button type="button" className="terminate-runner" disabled={runner?.status !== 'running'}
        onClick={() => void session.terminate()}>Terminate Runner</button>}
    </header>
    {session ? <RunnerControls control={session.control} /> : <section className="context-settings" aria-label={singleEntry ? 'Single Entry defaults' : 'Selected Runner settings'}>
      <div className="settings-grid">{['Project', 'Model', 'Account', 'Mode'].map(label =>
        <label className="setting" key={label}><span>{label}</span>
          <select aria-label={`${singleEntry ? 'Single Entry' : 'Runner'} ${label}`} disabled defaultValue="">
            <option value="">Not connected</option>
          </select>
        </label>)}
        <button className="command-button" type="button" disabled title="Command shortcuts are not connected">⌘ Commands</button>
      </div>
      <p className="scope-note">{singleEntry
        ? 'Defaults for future Runners. Existing Runners keep their own settings.'
        : 'Settings belong to this Runner. Single Entry defaults do not change this context.'}</p>
    </section>}
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
        <span className="empty-note">{singleEntry ? 'Verify an installation, then use New Runner.' : 'No connected process for this preview row.'}</span>
      </div>}
    </section>
    {session && <RunnerReferences control={session.control} selection={session.references} />}
    {session ? <RunnerComposer session={session} /> : <section className="composer-area" aria-label="Instruction composer">
      <div className="composer">
        <textarea aria-label={singleEntry ? 'Single Entry instructions' : 'Runner instructions'} disabled
          placeholder={singleEntry ? 'Instructions for a new Runner…' : 'Instructions for this Runner…'} rows={3} />
        <div className="composer-actions"><div className="attachments">
          <button type="button" disabled aria-label="Attach file" title="Attachments are not connected">＋ <span>Attach file</span></button>
          <button type="button" disabled aria-label="Attach folder" title="Attachments are not connected">▱ <span>Folder</span></button>
        </div><button className="send-button" type="button" disabled={!singleEntry || !installation || launching}
          onClick={onCreate} aria-label={singleEntry ? 'Create Runner' : 'Send instruction'}>
          {singleEntry ? 'Create Runner' : 'Send instruction'} <span aria-hidden="true">↗</span></button></div>
      </div>
      <p className="composer-note">{singleEntry ? 'Manual creation · each Runner has an independent terminal.' : 'No connected process.'} Attachments are unavailable.</p>
    </section>}
  </main>;
}
