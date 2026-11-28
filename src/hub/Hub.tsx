import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { RunnerSessions } from './RunnerSessions';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { useHubFileDrop, runnerAttachmentsDisabled, entryAttachmentsDisabled } from './hubFileDrop';
import { HubLog } from './HubLog';
import { createHubLogCapture } from './HubLogCapture';
import { TaskPanel } from './TaskPanel';
import { HubPreferences } from './preferences';
import { resolveTerminalTheme } from './terminalTheme';
import { errorText, initializeHubLanguage, useHubTranslation, type HubText } from './i18n';
import { ApplicationMenu, type ApplicationPreferences } from './ApplicationMenu';
import { InstallationDialog } from './InstallationDialog';
import { defaultShortcuts, useHubShortcuts } from './shortcuts';
import type { RunnerView } from './model';
import type { DomainDisplay, RunMode } from './RunnerNavigation';
import './hub.css';

export function Hub({ initialRunners = [] }: { initialRunners?: readonly RunnerView[] }) {
  const [fixtures, setRunners] = useState(() => [...initialRunners].sort((a, b) => a.createdOrder - b.createdOrder));
  const [preferences] = useState(() => {
    const store = new HubPreferences();
    initializeHubLanguage(store.value.language);
    return store;
  });
  const { t, tr } = useHubTranslation();
  const [sessions] = useState(() => {
    const owner = new RunnerSessions(preferences.value.singleEntry,
      singleEntry => preferences.update({ singleEntry }), preferences.value.runnerSelections,
      (id, value) => preferences.saveRunner(id, value), id => preferences.forgetRunner(id));
    owner.setTerminalTheme(resolveTerminalTheme(preferences.terminalTheme, preferences.value.theme));
    return owner;
  });
  const liveRunners = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
  const [hubLog] = useState(() => new HubLog(preferences.logRetentionDays));
  const [retentionDays, setRetentionDays] = useState(preferences.logRetentionDays);
  const [captureLog] = useState(() => createHubLogCapture(hubLog));
  useEffect(() => captureLog(sessions), [captureLog, sessions]);
  const [domainDisplay, setDomainDisplay] = useState<DomainDisplay>(preferences.value.domainDisplay ?? 'unified');
  const allRunners = [...fixtures, ...liveRunners];
  const domains = sessions.navigation.project(allRunners, domainDisplay);
  const runners = domains.flatMap(domain => domain.runners);
  const spare = sessions.spareSnapshot;
  const installation = spare.installation;
  const [setupRequired, setSetupRequired] = useState(true);
  const [shortcuts, setShortcuts] = useState(preferences.value.shortcuts ?? defaultShortcuts);
  const [launching, setLaunching] = useState(false);
  const launchPending = useRef(false);
  const [launchError, setLaunchError] = useState<HubText>('');
  useEffect(() => sessions.retain(), [sessions]);
  useEffect(() => {
    const closing = () => sessions.intentionalShutdown();
    window.addEventListener('beforeunload', closing);
    let removed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve().then(() => {
      if (!removed) return getCurrentWindow().onCloseRequested(closing);
    }).then(stop => {
      if (removed) stop?.(); else unlisten = stop;
    }).catch(() => { /* Browser previews have no native window. */ });
    return () => { removed = true; unlisten?.(); window.removeEventListener('beforeunload', closing); };
  }, [sessions]);
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
  const [terminalTheme, setTerminalTheme] = useState(preferences.terminalTheme);
  const [confirmRemoval, setConfirmRemoval] = useState(preferences.value.confirmRunnerRemoval);
  const selected = allRunners.find(runner => runner.id === selectedId) ?? sessions.failures.find(runner => runner.id === selectedId);
  const dropHost = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const dropSession = sessions.get(selectedId ?? undefined) ?? sessions.getFailure(selectedId ?? undefined);
  const fileDrop = useHubFileDrop(dropHost, selectedId === null ? {
    key: 'single-entry', selection: sessions.entry.attachments,
    disabled: () => setupRequired || entryAttachmentsDisabled(sessions.entry),
  } : dropSession ? {
    key: selectedId, selection: dropSession.references,
    disabled: () => setupRequired || runnerAttachmentsDisabled(dropSession),
  } : undefined);
  useEffect(() => { if (selectedId && !selected) setSelectedId(null); }, [selectedId, selected]);
  function rename(id: string, name: string) {
    const session = sessions.get(id);
    if (session) { session.rename(name); return; }
    setRunners(current => current.map(runner => runner.id === id ? { ...runner, name } : runner));
  }
  async function createRunner(mode?: RunMode) {
    if (!installation || launchPending.current) return;
    launchPending.current = true;
    setLaunching(true); setLaunchError('');
    try {
      const { session, launched } = sessions.allocate(installation.root, undefined, mode);
      setSelectedId(session.view.id);
      await launched;
    } catch (reason) { setLaunchError(errorText(reason)); }
    finally { launchPending.current = false; setLaunching(false); }
  }
  function closeRunner(id: string) {
    const index = runners.findIndex(runner => runner.id === id);
    if (!sessions.close(id)) return;
    const remaining = runners.filter(runner => runner.id !== id);
    const next = remaining[index] ?? remaining.at(-1);
    setSelectedId(current => current === id ? next?.id ?? null : current);
  }
  const appPreferences: ApplicationPreferences = {
    installation, theme, terminalTheme, confirmRemoval, domainDisplay, retentionDays, shortcuts,
    allocationPolicy: sessions.entry.allocationPolicy, reuseEditable: sessions.entry.editable,
    onAllocationPolicy: value => sessions.entry.setDefault('allocationPolicy', value),
    onShortcutsSave: value => {
      preferences.update({ shortcuts: value });
      setShortcuts(preferences.value.shortcuts ?? defaultShortcuts);
      return preferences.issue;
    },
    onRetentionDays: value => {
      preferences.update({ hubLogRetentionDays: value });
      setRetentionDays(preferences.logRetentionDays);
      if (!preferences.issue) void hubLog.retention(preferences.logRetentionDays);
    },
    onDomainDisplay: value => { preferences.update({ domainDisplay: value }); setDomainDisplay(value); },
    onConfirmRemoval: value => { preferences.update({ confirmRunnerRemoval: value }); setConfirmRemoval(value); },
    onLanguage: language => { preferences.update({ language }); initializeHubLanguage(language); },
    onTheme: value => {
      preferences.update({ theme: value });
      sessions.setTerminalTheme(resolveTerminalTheme(terminalTheme, value));
      setTheme(value);
    },
    onTerminalTheme: value => {
      preferences.update({ terminalTheme: value });
      sessions.setTerminalTheme(resolveTerminalTheme(value, theme));
      setTerminalTheme(value);
    },
    onVerified: value => {
      sessions.setInstallation(value);
      if (setupRequired) { setSetupRequired(false); setSelectedId(null); }
    },
  };
  return <div ref={dropHost} className="hub" data-theme={theme}>
    <header className="toolbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">A</span><strong>AgentRunnerHub</strong></div>
      {!setupRequired && <ApplicationMenu {...appPreferences} workspace={workspace} />}
      <span className="toolbar-location">{t('hub.workspace')} <span aria-hidden="true">/</span> {selected ? 'Runner' : t('common.singleEntry')}</span>
    </header>
    {preferences.issue && <p role="alert" className="runner-error preferences-error">{tr(preferences.issue)}</p>}
    {sessions.workspace.issue && <p role="alert" className="runner-error">{tr(sessions.workspace.issue)}</p>}
    {launchError && <p role="alert" className="runner-error">{tr(launchError)}</p>}
    <div ref={workspace} className="shell-body">
      <Sidebar domains={domains} runners={allRunners} domainDisplay={domainDisplay}
        selectedId={selectedId} onSelect={setSelectedId} onRename={rename}
        canDropRunner={(id, source, destination) => sessions.canDropRunner(id, source, destination)}
        onDropRunner={drop => sessions.dropRunner(fixtures, domainDisplay, drop)}
        restarts={sessions.restarts} onRestart={() => { sessions.restartAll(); }}
        onAdd={mode => void createRunner(mode)} addDisabled={!installation || launching} adding={launching}
        onRemove={closeRunner} confirmRemoval={confirmRemoval} failures={sessions.failures} />
      <Workspace key={selectedId ?? 'single-entry'} runner={selected}
        fileDropActive={fileDrop.active} fileDropUnavailable={fileDrop.unavailable}
        session={sessions.get(selectedId ?? undefined) ?? sessions.getFailure(selectedId ?? undefined)}
        failureActions={selectedId && sessions.getFailure(selectedId) ? {
          retry: () => sessions.retryFailure(selectedId),
          dismiss: () => sessions.dismissFailure(selectedId),
        } : undefined}
        installation={installation} hubLog={hubLog} selections={sessions.getSelections(selectedId ?? undefined)}
        entry={sessions.entry} onSelectRunner={setSelectedId} />
      <TaskPanel entry={sessions.entry} selections={sessions.getSelections(selectedId ?? undefined)}
        control={sessions.get(selectedId ?? undefined)?.control}
        scope={selectedId ?? 'single-entry'} />
    </div>
    {setupRequired && <InstallationDialog installation={installation} onVerified={appPreferences.onVerified}
      onClose={() => {}} setup={appPreferences} />}
  </div>;
}
