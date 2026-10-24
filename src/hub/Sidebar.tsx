import { useRef, useState } from 'react';
import type { RunnerView } from './model';

type SidebarProps = {
  runners: readonly RunnerView[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
};

function RunnerRow({ runner, active, onSelect, onRename }: {
  runner: RunnerView; active: boolean; onSelect: () => void; onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(runner.name);
  const rowButton = useRef<HTMLButtonElement>(null);
  function startRename() {
    onSelect();
    setDraft(runner.name);
    setEditing(true);
  }
  function finish(save: boolean, restoreFocus = false) {
    if (save && draft.trim()) onRename(draft);
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => rowButton.current?.focus());
  }
  return <li className={`runner-row ${active ? 'active' : ''}`} data-runner-id={runner.id}>
    <button ref={rowButton} className="nav-row" hidden={editing} type="button"
      aria-current={active ? 'page' : undefined} onClick={onSelect} onDoubleClick={startRename}
      onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); startRename(); } }}
      title={`${runner.name} · ${runner.status}. Double-click or press F2 to rename.`}>
      <span className={`status-dot ${runner.status}`} role="img" aria-label={runner.status} />
      <span className="runner-name">{runner.name}</span>
    </button>
    {editing && <div className="rename-row">
      <span className={`status-dot ${runner.status}`} aria-hidden="true" />
      <input aria-label="Runner name" value={draft} autoFocus onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)} onBlur={() => finish(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); finish(true, true); }
          if (event.key === 'Escape') { event.preventDefault(); finish(false, true); }
        }} />
    </div>}
    {!editing && <button type="button" className="rename-action" aria-label={`Rename ${runner.name}`}
      title="Rename Runner" onClick={startRename}>✎</button>}
  </li>;
}

export function Sidebar({ runners, selectedId, onSelect, onRename }: SidebarProps) {
  return <aside className="sidebar">
    <nav aria-label="Workspace navigation" onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('.nav-row')) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.nav-row:not([hidden])')];
      const index = buttons.indexOf(event.target);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1)
        : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
      <p className="sidebar-label">WORKSPACE</p>
      <button className={`nav-row single-entry ${selectedId === null ? 'active' : ''}`} type="button"
        aria-current={selectedId === null ? 'page' : undefined} onClick={() => onSelect(null)}>
        <span className="entry-icon" aria-hidden="true">⌘</span><span>Single Entry</span>
      </button>
      <div className="runner-section-label"><p className="sidebar-label">RUNNERS</p><span>{runners.length}</span></div>
      <ul className="runner-list">{runners.map(runner => <RunnerRow key={runner.id} runner={runner}
        active={selectedId === runner.id} onSelect={() => onSelect(runner.id)} onRename={name => onRename(runner.id, name)} />)}</ul>
      {runners.length === 0 && <p className="sidebar-empty">No Runners yet.<br />Your Runners will appear here.</p>}
    </nav>
    <div className="sidebar-footer"><span className="connection-dot" aria-hidden="true" />
      {runners.filter(runner => runner.status === 'running').length} processes running</div>
  </aside>;
}
