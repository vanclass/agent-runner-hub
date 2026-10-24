import { useEffect, useState, useSyncExternalStore } from 'react';
import { RunnerSessions } from './RunnerSessions';
import type { RunnerInstallation } from './RunnerLocation';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { ThemePicker } from './ThemePicker';
import type { RunnerView } from './model';
import './hub.css';

export function Hub({ initialRunners = [] }: { initialRunners?: readonly RunnerView[] }) {
  const [fixtures, setRunners] = useState(() => [...initialRunners].sort((a, b) => a.createdOrder - b.createdOrder));
  const [sessions] = useState(() => new RunnerSessions());
  const liveRunners = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
  const runners = [...fixtures, ...liveRunners];
  const [installation, setInstallation] = useState<RunnerInstallation | null>(null);
  const [launching, setLaunching] = useState(false);
  useEffect(() => () => sessions.dispose(), [sessions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'black'>('light');
  const selected = runners.find(runner => runner.id === selectedId);
  function rename(id: string, name: string) {
    const session = sessions.get(id);
    if (session) { session.rename(name); return; }
    setRunners(current => current.map(runner => runner.id === id ? { ...runner, name } : runner));
  }
  function createRunner() {
    if (!installation || launching) return;
    setLaunching(true);
    const { session, launched } = sessions.create(installation.root);
    setSelectedId(session.view.id);
    void launched.finally(() => setLaunching(false));
  }
  return <div className="hub" data-theme={theme}>
    <header className="toolbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">A</span><strong>AgentRunnerHub</strong></div>
      <span className="toolbar-location">Workspace <span aria-hidden="true">/</span> {selected ? 'Runner' : 'Single Entry'}</span>
      <ThemePicker theme={theme} onChange={setTheme} />
      <button type="button" className="new-runner" onClick={createRunner} disabled={!installation || launching}>
        New Runner
      </button>
    </header>
    <div className="shell-body">
      <Sidebar runners={runners} selectedId={selectedId} onSelect={setSelectedId} onRename={rename} />
      <Workspace key={selectedId ?? 'single-entry'} runner={selected} session={sessions.get(selectedId ?? undefined)}
        theme={theme} installation={installation} onInstallation={setInstallation} onCreate={createRunner} launching={launching} />
    </div>
  </div>;
}
