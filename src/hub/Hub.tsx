import { useEffect, useState, useSyncExternalStore } from 'react';
import { RunnerSessions } from './RunnerSessions';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { HubPreferences } from './preferences';
import { initializeHubLanguage, useHubTranslation } from './i18n';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import type { RunnerView } from './model';
import './hub.css';

export function Hub({ initialRunners = [] }: { initialRunners?: readonly RunnerView[] }) {
  const [fixtures, setRunners] = useState(() => [...initialRunners].sort((a, b) => a.createdOrder - b.createdOrder));
  const [preferences] = useState(() => {
    const store = new HubPreferences();
    initializeHubLanguage(store.value.language);
    return store;
  });
  const { t, tr } = useHubTranslation();
  const [sessions] = useState(() => new RunnerSessions(preferences.value.singleEntry,
    singleEntry => preferences.update({ singleEntry })));
  const liveRunners = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
  const runners = [...fixtures, ...liveRunners];
  const spare = sessions.spareSnapshot;
  const installation = spare.installation;
  const [launching, setLaunching] = useState(false);
  useEffect(() => sessions.retain(), [sessions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'black'>(preferences.value.theme);
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
      <span className="toolbar-location">{t('hub.workspace')} <span aria-hidden="true">/</span> {selected ? 'Runner' : t('common.singleEntry')}</span>
      <div className="hub-preferences">
        <LanguagePicker onChange={language => { preferences.update({ language }); initializeHubLanguage(language); }} />
        <ThemePicker theme={theme} onChange={value => { preferences.update({ theme: value }); setTheme(value); }} />
      </div>
      <button type="button" className="new-runner" onClick={createRunner} disabled={!installation || launching}>
        {t('hub.newRunner')}
      </button>
    </header>
    {preferences.issue && <p role="alert" className="runner-error preferences-error">{tr(preferences.issue)}</p>}
    {sessions.workspace.issue && <p role="alert" className="runner-error">{tr(sessions.workspace.issue)}</p>}
    <div className="shell-body">
      <Sidebar runners={runners} selectedId={selectedId} onSelect={setSelectedId} onRename={rename} />
      <Workspace key={selectedId ?? 'single-entry'} runner={selected} session={sessions.get(selectedId ?? undefined)}
        theme={theme} installation={installation} onInstallation={value => sessions.setInstallation(value)}
        sparePreparation={spare.detail}
        entry={sessions.entry} onSelectRunner={setSelectedId} />
    </div>
  </div>;
}
