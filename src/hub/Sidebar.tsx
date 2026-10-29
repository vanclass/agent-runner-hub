import { useHubTranslation, t } from './i18n';
import { useRef, useState } from 'react';
import type { RunnerView } from './model';
import { RunnerTabRemoval } from './RunnerTabRemoval';

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
  onRemove: (id: string) => void;
  confirmRemoval: boolean;
  failures: readonly RunnerView[];
  onAdd: () => void;
  addDisabled: boolean;
  adding: boolean;
};

function RunnerRow({ runner, active, onSelect, onRename, onRemove }: {
  runner: RunnerView; active: boolean; onSelect: () => void; onRename: (name: string) => void; onRemove: () => void;
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
      if (!editing) onRemove();
    }}>
    <button ref={rowButton} className="nav-row" hidden={editing} type="button" autoFocus={active}
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
    {!editing && <button type="button" className="remove-action" aria-label={t('tabs.removeNamed', { name: runner.name })}
      title={t('tabs.close')} onClick={onRemove}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      </svg>
    </button>}
  </li>;
}

export function Sidebar({ runners, selectedId, onSelect, onRename, onRemove, confirmRemoval, failures, onAdd, addDisabled, adding }: SidebarProps) {
  useHubTranslation();
  const [removing, setRemoving] = useState<RunnerView>();
  function remove(runner: RunnerView) {
    if (confirmRemoval) setRemoving(runner);
    else onRemove(runner.id);
  }
  return <aside className="sidebar">
    <nav aria-label={t('sidebar.navigation')} onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('.nav-row')) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.nav-row:not([hidden]):not(:disabled)')];
      const index = buttons.indexOf(event.target);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1)
        : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'End' ? buttons.length - 1 : -1;
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
        onRemove={() => remove(runner)} />)}
        <li className="add-runner-row"><button type="button" className="nav-row add-runner"
          aria-label={t('hub.newRunner')} title={t(adding ? 'hub.launching' : addDisabled ? 'hub.verifyFirst' : 'hub.newRunner')}
          disabled={addDisabled} aria-busy={adding} onClick={onAdd}>
          <span aria-hidden="true">+</span>
        </button></li>
      </ul>
      {failures.length > 0 && <section className="termination-failures" aria-label={t('tabs.failures')}>
        <p className="sidebar-label">{t('tabs.failures')}</p>
        <ul>{failures.map(runner => <li key={runner.id}><button type="button" className="nav-row"
          aria-current={selectedId === runner.id ? 'page' : undefined} onClick={() => onSelect(runner.id)}>
          <span className="status-dot failed" aria-hidden="true">!</span><span className="runner-name">{runner.name}</span>
        </button></li>)}</ul>
      </section>}
    </nav>
    {removing && <RunnerTabRemoval name={removing.name} onCancel={() => setRemoving(undefined)}
      onRemove={() => { onRemove(removing.id); setRemoving(undefined); }} />}
    <div className="sidebar-footer"><span className="connection-dot" aria-hidden="true" />
      {t('sidebar.processes', { count: runners.filter(runner => runner.status === 'running').length })}</div>
  </aside>;
}
