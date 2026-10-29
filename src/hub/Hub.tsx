import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RunnerSessions } from './RunnerSessions';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { TaskPanel } from './TaskPanel';
import { HubPreferences } from './preferences';
import { errorText, initializeHubLanguage, useHubTranslation, type HubText } from './i18n';
import { AppSettings } from './AppSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { defaultShortcuts, useHubShortcuts } from './shortcuts';
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
    singleEntry => preferences.update({ singleEntry }), preferences.value.runnerSelections,
    (id, value) => preferences.saveRunner(id, value)));
  const liveRunners = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
  const runners = [...fixtures, ...liveRunners];
  const spare = sessions.spareSnapshot;
  const installation = spare.installation;
  const [setupRequired, setSetupRequired] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(preferences.value.shortcuts ?? defaultShortcuts);
  const [launching, setLaunching] = useState(false);
  const launchPending = useRef(false);
  const [launchError, setLaunchError] = useState<HubText>('');
  useEffect(() => sessions.retain(), [sessions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useHubShortcuts(shortcuts, runners.map(runner => runner.id), selectedId === null && !!installation, {
    selectedId,
    select: id => { setSelectedId(id); requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(id === null ? '.composer textarea' : '.runner-row.active .nav-row')?.focus();
    }); },
    assign: () => { void sessions.entry.submit(installation!.root, setSelectedId); },
  });
  useEffect(() => { sessions.view(selectedId); return () => sessions.view(null); }, [sessions, selectedId]);
  const [theme, setTheme] = useState<'light' | 'black'>(preferences.value.theme);
  const [confirmRemoval, setConfirmRemoval] = useState(preferences.value.confirmRunnerRemoval);
  const selected = runners.find(runner => runner.id === selectedId) ?? sessions.failures.find(runner => runner.id === selectedId);
  useEffect(() => { if (selectedId && !selected) setSelectedId(null); }, [selectedId, selected]);
  function rename(id: string, name: string) {
    const session = sessions.get(id);
    if (session) { session.rename(name); return; }
    setRunners(current => current.map(runner => runner.id === id ? { ...runner, name } : runner));
  }
  async function createRunner() {
    if (!installation || launchPending.current) return;
    launchPending.current = true;
    setLaunching(true); setLaunchError('');
    try {
      const { session, launched } = sessions.allocate(installation.root);
      setSelectedId(session.view.id);
      await launched;
    } catch (reason) { setLaunchError(errorText(reason)); }
    finally { launchPending.current = false; setLaunching(false); }
  }
  function closeRunner(id: string) {
    if (!sessions.close(id)) return;
    preferences.forgetRunner(id);
    const remaining = sessions.getSnapshot();
    const order = runners.find(runner => runner.id === id)?.createdOrder ?? 0;
    const next = remaining.find(runner => runner.createdOrder > order) ?? remaining.at(-1);
    setSelectedId(current => current === id ? next?.id ?? null : current);
  }
  return <div className="hub" data-theme={theme}>
    <header className="toolbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">A</span><strong>AgentRunnerHub</strong></div>
      <span className="toolbar-location">{t('hub.workspace')} <span aria-hidden="true">/</span> {selected ? 'Runner' : t('common.singleEntry')}</span>
      <div className="hub-preferences">
        <button type="button" className="shortcut-settings-trigger" aria-haspopup="dialog"
          onClick={() => setShortcutsOpen(true)}>{t('shortcuts.title')}</button>
        <button type="button" className="app-settings-trigger" aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}>{t('setup.settings')}</button>
      </div>
    </header>
    {preferences.issue && <p role="alert" className="runner-error preferences-error">{tr(preferences.issue)}</p>}
    {sessions.workspace.issue && <p role="alert" className="runner-error">{tr(sessions.workspace.issue)}</p>}
    {launchError && <p role="alert" className="runner-error">{tr(launchError)}</p>}
    <div className="shell-body">
      <Sidebar runners={runners} selectedId={selectedId} onSelect={setSelectedId} onRename={rename}
        onAdd={() => void createRunner()} addDisabled={!installation || launching} adding={launching}
        onRemove={closeRunner} confirmRemoval={confirmRemoval} failures={sessions.failures} />
      <Workspace key={selectedId ?? 'single-entry'} runner={selected}
        session={sessions.get(selectedId ?? undefined) ?? sessions.getFailure(selectedId ?? undefined)}
        theme={theme} installation={installation}
        entry={sessions.entry} onSelectRunner={setSelectedId} />
      <TaskPanel entry={sessions.entry} selections={sessions.getSelections(selectedId ?? undefined)}
        control={sessions.get(selectedId ?? undefined)?.control}
        restarts={sessions.restarts} onRestart={() => { sessions.restartAll(); }}
        scope={selectedId ?? 'single-entry'} />
    </div>
    {shortcutsOpen && <ShortcutSettings value={shortcuts} onClose={() => setShortcutsOpen(false)} onSave={value => {
      preferences.update({ shortcuts: value }); setShortcuts(preferences.value.shortcuts ?? defaultShortcuts);
      return preferences.issue;
    }} />}
    {(setupRequired || settingsOpen) && <AppSettings required={setupRequired} installation={installation} theme={theme}
      confirmRemoval={confirmRemoval} onConfirmRemoval={value => {
        preferences.update({ confirmRunnerRemoval: value }); setConfirmRemoval(value);
      }}
      onLanguage={language => { preferences.update({ language }); initializeHubLanguage(language); }}
      onTheme={value => { preferences.update({ theme: value }); setTheme(value); }}
      onVerified={value => {
        sessions.setInstallation(value);
        if (setupRequired) { setSetupRequired(false); setSelectedId(null); }
      }} onClose={() => setSettingsOpen(false)} />}
  </div>;
}
