import { useHubTranslation, t, tr, msg, errorText, HubError, type HubText } from './i18n';
import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export type RunnerInstallation = { root: string; python: string };
const storageKey = 'agent-runner-hub.installation';
function savedLocation() { try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; } }

export function RunnerLocation({ installation, onChange }: {
  installation: RunnerInstallation | null; onChange: (installation: RunnerInstallation | null) => void;
}) {
  useHubTranslation();
  const [location, setLocation] = useState(() => installation?.root ?? savedLocation());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<HubText>('');
  async function verify() {
    setPending(true); setError(''); onChange(null);
    try {
      if (!isTauri()) throw new HubError(msg('location.nativeRequired'));
      const result = await invoke<RunnerInstallation>('runner_resolve', { location });
      onChange(result);
      try { localStorage.setItem(storageKey, result.root); } catch { /* The verified location remains usable for this Hub window. */ }
    } catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  }
  return <section className="runner-location" aria-label={t('location.installation')}>
    <label>{t('location.label')}<input aria-label={t('location.label')} value={location} disabled={pending}
      placeholder={t('location.placeholder')} onChange={event => { setLocation(event.target.value); onChange(null); setError(''); }} /></label>
    <button type="button" disabled={pending || !location.trim()} onClick={() => void verify()}>{t('location.verify')}</button>
    <p>{t('location.help')}</p>
    {pending && <p role="status">{t('location.verifying')}</p>}
    {installation && <p role="status">{t('location.verified')}</p>}
    {error && <p role="alert">{tr(error)}</p>}
  </section>;
}
