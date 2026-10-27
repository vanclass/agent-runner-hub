import { useHubTranslation, t } from './i18n';
import { useRef, useState } from 'react';
import type { RunnerView } from './model';

const runnerStatus = (status: RunnerView['status']) => {
  const keys = { idle: 'status.idle', running: 'status.running', attention: 'status.attention',
    disconnected: 'status.disconnected', starting: 'status.starting', exited: 'status.exited', failed: 'status.failed' } as const;
  return t(keys[status]);
};
const workStatus = (status: NonNullable<RunnerView['activity']>) => {
  const keys = { idle: 'tabs.states.idle', running: 'tabs.states.running', attention: 'tabs.states.attention',
    completed: 'tabs.states.completed', failed: 'tabs.states.failed', interrupted: 'tabs.states.interrupted',
    unknown: 'tabs.states.unknown' } as const;
  return t(keys[status]);
};

type SidebarProps = {
  runners: readonly RunnerView[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onMiddleClose: (id: string) => void;
};

function RunnerRow({ runner, active, onSelect, onRename, onMiddleClose }: {
  runner: RunnerView; active: boolean; onSelect: () => void; onRename: (name: string) => void; onMiddleClose: () => void;
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
  const status = runner.activity ? workStatus(runner.activity) : runnerStatus(runner.status);
  const symbol = runner.activity === 'completed' ? '✓' : runner.activity === 'failed' ? '×'
    : runner.activity === 'interrupted' ? '■' : runner.activity === 'unknown' ? '?' : '';
  return <li className={`runner-row ${active ? 'active' : ''}`} data-runner-id={runner.id}
    onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
    onAuxClick={event => {
      if (event.button !== 1) return;
      event.preventDefault(); event.stopPropagation();
      if (!editing) onMiddleClose();
    }}>
    <button ref={rowButton} className="nav-row" hidden={editing} type="button"
      aria-current={active ? 'page' : undefined} onClick={event => { if (event.button === 0) onSelect(); }}
      onDoubleClick={event => { if (event.button === 0) startRename(); }}
      onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); startRename(); } }}
      title={t('sidebar.rowHint', { name: runner.name, status })}>
      <span className={`status-dot ${runner.activity ?? runner.status}`} role="img" aria-label={status}>{symbol}</span>
      <span className="runner-name">{runner.name}</span>
      {runner.unreadCompletion && <span className="unread-completion" role="img" aria-label={t('tabs.unread')}>●</span>}
    </button>
    {editing && <div className="rename-row">
      <span className={`status-dot ${runner.status}`} aria-hidden="true" />
      <input aria-label={t('sidebar.runnerName')} value={draft} autoFocus onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)} onBlur={() => finish(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); finish(true, true); }
          if (event.key === 'Escape') { event.preventDefault(); finish(false, true); }
        }} />
    </div>}
    {!editing && <button type="button" className="rename-action" aria-label={t('sidebar.renameNamed', { name: runner.name })}
      title={t('sidebar.rename')} onClick={event => { if (event.button === 0) startRename(); }}>✎</button>}
  </li>;
}

export function Sidebar({ runners, selectedId, onSelect, onRename, onMiddleClose }: SidebarProps) {
  useHubTranslation();
  return <aside className="sidebar">
    <nav aria-label={t('sidebar.navigation')} onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('.nav-row')) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.nav-row:not([hidden])')];
      const index = buttons.indexOf(event.target);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1)
        : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
      <p className="sidebar-label">{t('sidebar.workspace')}</p>
      <button className={`nav-row single-entry ${selectedId === null ? 'active' : ''}`} type="button"
        aria-current={selectedId === null ? 'page' : undefined} onClick={() => onSelect(null)}>
        <span className="entry-icon" aria-hidden="true">⌘</span><span>{t('common.singleEntry')}</span>
      </button>
      <div className="runner-section-label"><p className="sidebar-label">{t('sidebar.runners')}</p><span>{runners.length}</span></div>
      <ul className="runner-list">{runners.map(runner => <RunnerRow key={runner.id} runner={runner}
        active={selectedId === runner.id} onSelect={() => onSelect(runner.id)} onRename={name => onRename(runner.id, name)}
        onMiddleClose={() => onMiddleClose(runner.id)} />)}</ul>
      {runners.length === 0 && <p className="sidebar-empty">{t('sidebar.empty')}<br />{t('sidebar.emptyHint')}</p>}
    </nav>
    <div className="sidebar-footer"><span className="connection-dot" aria-hidden="true" />
      {t('sidebar.processes', { count: runners.filter(runner => runner.status === 'running').length })}</div>
  </aside>;
}
