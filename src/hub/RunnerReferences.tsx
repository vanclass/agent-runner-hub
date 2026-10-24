import { useEffect, useState } from 'react';
import { selectFiles, selectFolder, watchFileDrop } from '../../.runner/web-app-desktop/io/nativeIO';
import { commandNamed, type RunnerControl } from './runnerControl';

export class RunnerReferenceSelection {
  paths: string[] = [];
  constructor(private readonly changed: () => void) {}
  select(paths: string[]) { this.paths = [...new Set(paths)]; this.changed(); }
  clear() { this.paths = []; this.changed(); }
  async choose(folder: boolean) {
    const result = await (folder ? selectFolder() : selectFiles(true));
    if (result) this.select(Array.isArray(result) ? result : [result]);
  }
}
export function RunnerReferences({ control, selection }: { control: RunnerControl; selection: RunnerReferenceSelection }) {
  const [error, setError] = useState('');
  const files = commandNamed(control.snapshot, '/files');
  const available = control.snapshot.state === 'ready' && !!files?.enabled && !control.busy;
  const unavailable = files?.disabled_reason || 'This Runner does not currently offer /files.';
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve().then(() => watchFileDrop(paths => {
      if (disposed) return;
      if (available) { selection.select(paths); setError(''); }
      else setError(unavailable);
    })).then(stop => { if (disposed) void Promise.resolve(stop()).catch(() => {}); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; void Promise.resolve(unlisten?.()).catch(() => {}); };
  }, [available, unavailable, selection]);
  async function choose(folder: boolean) {
    setError('');
    try {
      await selection.choose(folder);
    } catch (reason) { setError(String(reason)); }
  }
  async function openFiles() {
    setError('');
    try { await control.command('/files'); }
    catch (reason) { setError(String(reason)); }
  }
  return <details className="runner-references" open={selection.paths.length > 0 || !!error}>
    <summary>Files and images</summary>
    <div className="reference-actions">
      <button type="button" disabled={!available} title={available ? 'Choose paths for the Runner /files flow' : unavailable}
        onClick={() => void choose(false)}>Choose files</button>
      <button type="button" disabled={!available} title={available ? 'Choose a folder path' : unavailable}
        onClick={() => void choose(true)}>Choose folder</button>
      <button type="button" disabled={!available} title={unavailable} onClick={() => void openFiles()}>Open /files in terminal</button>
      <button type="button" disabled title="Runner v1 cannot verify registration of a clipboard image">Clipboard image unavailable</button>
    </div>
    <p>Choose or drop paths here, then use /files → Add → Direct input in the terminal. Copy the path below into that flow.</p>
    {selection.paths.map(path => <label className="reference-path" key={path}>Selected path
      <input aria-label={`Selected path ${path}`} readOnly value={path} onFocus={event => event.currentTarget.select()} /></label>)}
    {selection.paths.length > 0 && <button type="button" onClick={() => selection.clear()}>Clear selected paths</button>}
    <p>Selected paths are not confirmed attachments. Runner v1 has no registration receipt or reference inventory for Hub to verify.
      Clipboard-image delivery and inline image previews are unavailable until Runner supplies verified reference and media locators.</p>
    {error && <p role="alert">{error}</p>}
  </details>;
}
