import { useEffect, useRef } from 'react';
import { RunnerLocation } from './RunnerLocation';
import type { RunnerInstallation } from './runnerInstallation';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import { useHubTranslation } from './i18n';
import type { HubLanguage } from './preferences';
import type { DomainDisplay } from './RunnerNavigation';
import type { EntryDefaults } from './singleEntry';

export function AppSettings({ required, installation, theme, confirmRemoval, onConfirmRemoval, allocationPolicy, reuseEditable, onAllocationPolicy, onTheme, onLanguage, onVerified, onClose, onShortcuts, domainDisplay, onDomainDisplay }: {
  required: boolean; installation: RunnerInstallation | null; theme: 'light' | 'black';
  onTheme: (theme: 'light' | 'black') => void; onLanguage: (language: HubLanguage) => void;
  onVerified: (installation: RunnerInstallation) => void; onClose: () => void;
  confirmRemoval: boolean; onConfirmRemoval: (value: boolean) => void;
  onShortcuts: () => void;
  allocationPolicy: EntryDefaults['allocationPolicy']; reuseEditable: boolean;
  onAllocationPolicy: (value: NonNullable<EntryDefaults['allocationPolicy']>) => void;
  domainDisplay: DomainDisplay; onDomainDisplay: (value: DomainDisplay) => void;
}) {
  const { t } = useHubTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLElement>(required ? 'input' : '.shortcut-settings-trigger')?.focus();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="app-settings" aria-labelledby="installation-title"
    aria-describedby="installation-description" onCancel={event => { event.preventDefault(); if (!required) onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="installation-brand"><span className="brand-mark" aria-hidden="true">A</span><strong>AgentRunnerHub</strong></div>
    {!required && <button type="button" className="settings-close" aria-label={t('setup.close')} onClick={onClose}>×</button>}
    <h1 id="installation-title">{t(required ? 'setup.title' : 'setup.settings')}</h1>
    <p id="installation-description">{t(required ? 'setup.description' : 'setup.changeHelp')}</p>
    <RunnerLocation installation={installation} required={required} onChange={onVerified} />
    <div className="app-appearance">
      <LanguagePicker onChange={onLanguage} />
      <ThemePicker theme={theme} onChange={onTheme} />
    </div>
    <label className="domain-preference">{t('sidebar.domainDisplay')}
      <select value={domainDisplay} onChange={event => onDomainDisplay(event.target.value as DomainDisplay)}>
        <option value="unified">{t('sidebar.unified')}</option>
        <option value="run-mode">{t('sidebar.byMode')}</option>
      </select>
    </label>
    <label className="removal-preference"><input type="checkbox" checked={confirmRemoval}
      onChange={event => onConfirmRemoval(event.target.checked)} />{t('tabs.confirmPreference')}</label>
    <label className="domain-preference" title={t('work.allocationHelp')}>{t('work.allocationPolicy')}
      <select value={allocationPolicy} disabled={!reuseEditable} onChange={event =>
        onAllocationPolicy(event.target.value as NonNullable<EntryDefaults['allocationPolicy']>)}>
        <option value="always-new">{t('work.alwaysNew')}</option>
        <option value="reuse-same-mode">{t('work.reuseSameMode')}</option>
        <option value="reuse-idle">{t('work.reuseIdle')}</option>
      </select>
    </label>
    {!required && <button type="button" className="shortcut-settings-trigger" aria-haspopup="dialog"
      onClick={onShortcuts}>{t('shortcuts.title')}</button>}
  </dialog>;
}
