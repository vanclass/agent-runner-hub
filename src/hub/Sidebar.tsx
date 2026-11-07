import { useHubTranslation, t, tr } from './i18n';
import type { RunnerRestarts } from './RunnerRestarts';
import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import type { RunMode, RunnerDomain } from './RunnerNavigation';
import { runModeLabel } from './runModeLabel';
import type { RunnerView } from './model';
import { RunnerTabRemoval } from './RunnerTabRemoval';

type MarkerState = 'idle' | 'running' | 'attention' | 'failed' | 'starting' | 'unknown';
const statusLabel = (state: MarkerState) => t(({ idle: 'tabs.states.idle', running: 'tabs.states.running',
  attention: 'tabs.states.attention', failed: 'tabs.states.failed', starting: 'status.starting',
  unknown: 'tabs.states.unknown' } as const)[state]);
function StatusMarker({ state }: { state: MarkerState }) {
  const label = statusLabel(state);
  return <span className={`status-dot ${state}`} role="img" aria-label={label} title={label}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {state === 'idle' ? <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
        : state === 'starting' ? <path d="M12 3a9 9 0 1 1-9 9" /> : <>
          <circle cx="12" cy="12" r="9" />
          {state === 'running' ? <path d="m10 8 6 4-6 4Z" />
            : state === 'attention' ? <path d="M12 7v6m0 4h.01" />
              : state === 'failed' ? <path d="m9 9 6 6m0-6-6 6" />
                : <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01" />}
        </>}
    </svg>
  </span>;
}

type SidebarProps = {
  domains: readonly RunnerDomain[];
  onReorder: (domain: RunnerDomain['id'], id: string, before: string | null, expected: readonly string[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  confirmRemoval: boolean;
  failures: readonly RunnerView[];
  onAdd: (mode?: RunMode) => void;
  addDisabled: boolean;
  adding: boolean;
  restarts: RunnerRestarts;
  onRestart: () => void;
};

function RunnerRow({ runner, active, onSelect, onRename, onRemove, drag, dropBefore }: {
  runner: RunnerView; active: boolean; onSelect: () => void; onRename: (name: string) => void; onRemove: () => void;
  drag: HTMLAttributes<HTMLLIElement>; dropBefore: boolean;
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
  const state: MarkerState = runner.activity && !['completed', 'interrupted'].includes(runner.activity)
    ? runner.activity as MarkerState : runner.status === 'starting' ? 'starting' : runner.status === 'failed' ? 'failed' : 'unknown';
  const status = statusLabel(state);
  return <li {...drag} draggable={!editing} className={`runner-row ${active ? 'active' : ''} ${dropBefore ? 'drop-before' : ''}`} data-runner-id={runner.id}
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
      <StatusMarker state={state} />
      <span className="runner-name">{runner.name}</span>
      {runner.unreadCompletion && <span className="unread-completion" role="img" aria-label={t('tabs.unread')}>●</span>}
    </button>
    {editing && <div className="rename-row">
      <StatusMarker state={state} />
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

export function Sidebar({ domains, onReorder, selectedId, onSelect, onRename, onRemove, confirmRemoval, failures, onAdd, addDisabled, adding, restarts, onRestart }: SidebarProps) {
  useHubTranslation();
  const runners = domains.flatMap(domain => domain.runners);
  type Drag = { domain: RunnerDomain['id']; id: string; ids: string[]; before: string | null };
  const [drag, setDrag] = useState<Drag>();
  const dragging = useRef<Drag>();
  const clearDrag = () => { dragging.current = undefined; setDrag(undefined); };
  const signature = JSON.stringify(domains.map(d => [d.id, d.runners.map(r => r.id)]));
  useEffect(() => { clearDrag(); }, [signature]);
  const [removing, setRemoving] = useState<RunnerView>();
  const restart = restarts.snapshot;
  function startDrag(event: DragEvent, domain: RunnerDomain, id: string) {
    if ((event.target as HTMLElement).closest('input, .rename-action, .remove-action')) { event.preventDefault(); return; }
    dragging.current = { domain: domain.id, id, ids: domain.runners.map(r => r.id), before: id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }
  function hover(event: DragEvent<HTMLUListElement>, domain: RunnerDomain) {
    const current = dragging.current;
    if (!current || current.domain !== domain.id) { setDrag(undefined); return; }
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.runner-row')];
    const target = rows.find(row => event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    const next = { ...current, before: target?.dataset.runnerId ?? null };
    dragging.current = next; setDrag(next);
  }
  function drop(event: DragEvent, domain: RunnerDomain) {
    event.preventDefault();
    const current = dragging.current;
    if (current?.domain === domain.id) onReorder(domain.id, current.id, current.before, current.ids);
    clearDrag();
  }
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
      <div className="runner-section-label"><p className="sidebar-label">{t('sidebar.runners')}</p><span>{runners.length}</span>
        <details className="runner-management"><summary aria-label={t('panel.runnerManagement')} title={t('panel.runnerManagement')}>⋯</summary>
          <button type="button" disabled={restarts.pending} onClick={onRestart}>{t('restart.action')}</button>
        </details>
      </div>
      {(restart.pending > 0 || restart.running > 0 || restart.failed > 0) && <p className="restart-status" role="status">{t('restart.progress', { restarted: restart.restarted,
        running: restart.running, pending: restart.pending, failed: restart.failed, removed: restart.removed })}</p>}
      {restart.pending > 0 && <p className="restart-status">{t('restart.pending')}</p>}
      {restart.failures.map((failure, index) => <p className="restart-status" role="alert" key={index}>{failure.name}: {tr(failure.detail)}</p>)}
      <div className="runner-domains" onDragEnd={clearDrag} onKeyDown={event => { if (event.key === 'Escape') clearDrag(); }}>
        {domains.map(domain => <section className="runner-domain" key={domain.id} data-domain={domain.id}>
          {domain.id !== 'runner' && <p className="sidebar-label">{runModeLabel(domain.id)}</p>}
          <ul className={`runner-list ${drag?.domain === domain.id && drag.before === null ? 'drop-end' : ''}`}
            onDragOver={event => hover(event, domain)} onDrop={event => drop(event, domain)}>
            {domain.runners.map(runner => <RunnerRow key={runner.id} runner={runner}
              drag={{ onDragStart: event => startDrag(event, domain, runner.id), onDragEnd: clearDrag }}
              dropBefore={drag?.domain === domain.id && drag.before === runner.id}
              active={selectedId === runner.id} onSelect={() => onSelect(runner.id)} onRename={name => onRename(runner.id, name)}
              onRemove={() => remove(runner)} />)}
          </ul>
          <button type="button" className="add-runner nav-row" aria-label={t('hub.newRunner')}
            title={t(adding ? 'hub.launching' : addDisabled ? 'hub.verifyFirst' : 'hub.newRunner')}
            disabled={addDisabled} aria-busy={adding} onClick={() => onAdd(domain.id === 'runner' ? undefined : domain.id)}>+</button>
        </section>)}
      </div>
      {failures.length > 0 && <section className="termination-failures" aria-label={t('tabs.failures')}>
        <p className="sidebar-label">{t('tabs.failures')}</p>
        <ul>{failures.map(runner => <li key={runner.id}><button type="button" className="nav-row"
          aria-current={selectedId === runner.id ? 'page' : undefined} onClick={() => onSelect(runner.id)}>
          <StatusMarker state="failed" /><span className="runner-name">{runner.name}</span>
        </button></li>)}</ul>
      </section>}
    </nav>
    {removing && <RunnerTabRemoval name={removing.name} onCancel={() => setRemoving(undefined)}
      onRemove={() => { onRemove(removing.id); setRemoving(undefined); }} />}
    <div className="sidebar-footer"><span className="connection-dot" aria-hidden="true" />
      {t('sidebar.processes', { count: runners.filter(runner => runner.status === 'running').length })}</div>
  </aside>;
}
