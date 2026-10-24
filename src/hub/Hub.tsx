import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { ThemePicker } from './ThemePicker';
import type { RunnerView } from './model';
import './hub.css';

export function Hub({ initialRunners = [] }: { initialRunners?: readonly RunnerView[] }) {
  const [runners, setRunners] = useState(() => [...initialRunners].sort((a, b) => a.createdOrder - b.createdOrder));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'black'>('light');
  const selected = runners.find(runner => runner.id === selectedId);
  function rename(id: string, name: string) {
    setRunners(current => current.map(runner => runner.id === id ? { ...runner, name } : runner));
  }
  return <div className="hub" data-theme={theme}>
    <header className="toolbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">A</span><strong>AgentRunnerHub</strong></div>
      <span className="toolbar-location">Workspace <span aria-hidden="true">/</span> {selected ? 'Runner' : 'Single Entry'}</span>
      <ThemePicker theme={theme} onChange={setTheme} />
    </header>
    <div className="shell-body">
      <Sidebar runners={runners} selectedId={selectedId} onSelect={setSelectedId} onRename={rename} />
      <Workspace key={selectedId ?? 'single-entry'} runner={selected} />
    </div>
  </div>;
}
