import { useEffect, useRef } from 'react';
import { RunnerLocation } from './RunnerLocation';
import type { RunnerInstallation } from './runnerInstallation';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import { useHubTranslation } from './i18n';
import type { HubLanguage } from './preferences';

export function AppSettings({ required, installation, theme, onTheme, onLanguage, onVerified, onClose }: {
  required: boolean; installation: RunnerInstallation | null; theme: 'light' | 'black';
  onTheme: (theme: 'light' | 'black') => void; onLanguage: (language: HubLanguage) => void;
  onVerified: (installation: RunnerInstallation) => void; onClose: () => void;
}) {
  const { t } = useHubTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLInputElement>('input')?.focus();
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
  </dialog>;
}
