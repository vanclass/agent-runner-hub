import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export type RunnerInstallation = { root: string; python: string };
const storageKey = 'agent-runner-hub.installation';
function savedLocation() { try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; } }

export function RunnerLocation({ installation, onChange }: {
  installation: RunnerInstallation | null; onChange: (installation: RunnerInstallation | null) => void;
}) {
  const [location, setLocation] = useState(() => installation?.root ?? savedLocation());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function verify() {
    setPending(true); setError(''); onChange(null);
    try {
      if (!isTauri()) throw new Error('Open the native desktop Hub to connect to local Runner processes.');
      const result = await invoke<RunnerInstallation>('runner_resolve', { location });
      onChange(result);
      try { localStorage.setItem(storageKey, result.root); } catch { /* The verified location remains usable for this Hub window. */ }
    } catch (reason) { setError(String(reason)); }
    finally { setPending(false); }
  }
  return <section className="runner-location" aria-label="AgentRunner installation">
    <label>AgentRunner location<input aria-label="AgentRunner location" value={location} disabled={pending}
      placeholder="Local installation path" onChange={event => { setLocation(event.target.value); onChange(null); setError(''); }} /></label>
    <button type="button" disabled={pending || !location.trim()} onClick={() => void verify()}>Verify installation</button>
    <p>Choose the workspace containing agent_runner, or the agent_runner folder. Each new Runner uses its own terminal.</p>
    {pending && <p role="status">Verifying the installed Runner and managed Python…</p>}
    {installation && <p role="status">Verified installation. Use New Runner to open an independent process.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
