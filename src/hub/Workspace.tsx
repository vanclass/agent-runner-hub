import type { RunnerView } from './model';

export function Workspace({ runner }: { runner?: RunnerView }) {
  const singleEntry = !runner;
  return <main className="workspace" aria-label={singleEntry ? 'Single Entry workspace' : 'Runner workspace'}>
    <header className="workspace-header">
      <div className="context-title"><span className="eyebrow">{singleEntry ? 'STARTING POINT' : 'RUNNER WORKSPACE'}</span>
        <h1 title={runner?.name}>{runner?.name ?? 'Single Entry'}</h1></div>
      <span className="context-badge">{singleEntry ? 'New Runner defaults' : 'This Runner only'}</span>
    </header>
    <section className="context-settings" aria-label={singleEntry ? 'Single Entry defaults' : 'Selected Runner settings'}>
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
    </section>
    <section className="output" aria-label="Output viewport">
      <div className="output-label"><span>OUTPUT</span><span className="quiet-status">Not connected</span></div>
      <div className="empty-workspace">
        <div className="workspace-symbol" aria-hidden="true">{singleEntry ? '↗' : '›_'}</div>
        <h2>{singleEntry ? 'A place to begin.' : 'Ready for a connection.'}</h2>
        <p>{singleEntry ? 'Bring your next task into focus. Runner output will live here.' : 'This Runner has no connected output stream.'}</p>
        <span className="empty-note">Process connections are not available yet.</span>
      </div>
    </section>
    <section className="composer-area" aria-label="Instruction composer">
      <div className="composer">
        <textarea aria-label={singleEntry ? 'Single Entry instructions' : 'Runner instructions'} disabled
          placeholder={singleEntry ? 'Instructions for a new Runner…' : 'Instructions for this Runner…'} rows={3} />
        <div className="composer-actions"><div className="attachments">
          <button type="button" disabled aria-label="Attach file" title="Attachments are not connected">＋ <span>Attach file</span></button>
          <button type="button" disabled aria-label="Attach folder" title="Attachments are not connected">▱ <span>Folder</span></button>
        </div><button className="send-button" type="button" disabled aria-label={singleEntry ? 'Create Runner' : 'Send instruction'}>
          {singleEntry ? 'Create Runner' : 'Send instruction'} <span aria-hidden="true">↗</span></button></div>
      </div>
      <p className="composer-note">Not connected · {singleEntry ? 'Runner creation' : 'Task dispatch'} and attachments are unavailable.</p>
    </section>
  </main>;
}
