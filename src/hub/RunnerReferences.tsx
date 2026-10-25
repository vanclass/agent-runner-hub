import { useEffect, useState } from 'react';
import { watchFileDrop } from '../../.runner/web-app-desktop/io/nativeIO';
import { commandNamed, type RunnerControl } from './runnerControl';
import type { RunnerReferenceSelection } from './referenceSelection';
export function RunnerReferences({ control, selection }: { control: RunnerControl; selection: RunnerReferenceSelection }) {
  const [error, setError] = useState('');
  const files = commandNamed(control.snapshot, '/files');
  const available = selection.available;
  const unavailable = files?.disabled_reason || 'This Runner does not currently offer /files.';
  const inventory = selection.inventory;
  const foreground = selection.results.some(result => result.state === 'pending-interaction');
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
  return <details className="runner-references" open={selection.staging || selection.paths.length > 0 || !!error || !!inventory || !!selection.error}>
    <summary>Files and images</summary>
    <div className="reference-actions">
      <button type="button" disabled={!available} title={available ? selection.capable ? 'Register files with this Runner' : 'Choose paths for the Runner /files flow' : unavailable}
        onClick={() => void choose(false)}>Choose files</button>
      <button type="button" disabled={!available} title={available ? 'Choose a folder path' : unavailable}
        onClick={() => void choose(true)}>Choose folder</button>
      <button type="button" disabled={!available} title={unavailable} onClick={() => void openFiles()}>Open /files in terminal</button>
      <button type="button" disabled={!selection.clipboardAvailable}
        title={selection.clipboardAvailable ? 'Capture one clipboard image for this Runner'
          : selection.capable && !control.snapshot.clipboardStaging ? 'Clipboard image capture is unavailable in this build.'
            : 'Requires supported native clipboard capture and an available authenticated Runner reference capability'}
        onClick={() => void selection.captureClipboard()}>
        {selection.capable && control.snapshot.clipboardStaging ? 'Clipboard image' : 'Clipboard image unavailable'}</button>
      {selection.capable && <>
        <button type="button" disabled={!available || !selection.candidates.some(item => selection.state(item) === 'selected')}
          onClick={() => void selection.registerSelected()}>Register selected paths</button>
        <button type="button" disabled={!available} onClick={() => void selection.refresh()}>Refresh pending references</button>
        {inventory?.next_offset != null && <button type="button" disabled={!available}
          onClick={() => void selection.refresh(inventory.next_offset!)}>Next reference page</button>}
      </>}
    </div>
    {selection.staging && <p role="status">Reading clipboard and staging PNG for this Runner…</p>}
    {(selection.registering || selection.listing) && <p role="status">{foreground
      ? 'Continue in this Runner terminal: select image detail or cancel the pending interaction.'
      : selection.listing ? 'Reading Runner inventory…' : 'Registering paths with this Runner…'}</p>}
    <p>{selection.capable ? 'Choose or drop files and folders to register them with this Runner. Image detail and cancellation stay in its terminal.'
      : 'Choose or drop paths here, then use /files → Add → Direct input in the terminal. Copy the path below into that flow.'}</p>
    {selection.capable && inventory && <section aria-label="Registered pending references">
      <h3>Registered pending references</h3>
      {control.snapshot.state !== 'ready' && <p role="status">Last inventory sample · Runner unavailable. References are not restored into another process.</p>}
      <p>{inventory.total_count} pending · Page offset {inventory.offset}. Each page is sampled independently; terminal changes can shift later pages. Refresh starts at the first page.</p>
      {inventory.references.length === 0 && <p>No references on this page.</p>}
      <ol start={inventory.offset + 1}>{inventory.references.map(reference => <li key={reference.reference_id}>
        {reference.display_name} · {reference.kind}{reference.image_detail && ` · Detail: ${reference.image_detail}`}{reference.media_kind && ` · ${reference.media_kind}`}
        <br /><code>{reference.reference_id}</code>
      </li>)}</ol>
    </section>}
    {selection.candidates.length > 0 && <h3>Registration attempts</h3>}
    {selection.candidates.map(candidate => <div className="reference-candidate" key={candidate.key}>
      <label className="reference-path">{candidate.source === 'clipboard' ? 'Staged clipboard image' : 'Selected path'}
        <input aria-label={`Selected path ${candidate.path}`} readOnly value={candidate.path} onFocus={event => event.currentTarget.select()} /></label>
      <p role="status">{candidate.source === 'clipboard' && selection.state(candidate) === 'selected'
        ? 'Staged · unregistered' : referenceState(selection.state(candidate))}
        {selection.result(candidate)?.reference && <> · Reference ID: <code>{selection.result(candidate)!.reference!.reference_id}</code></>}
        {selection.result(candidate)?.code && <> · {selection.result(candidate)!.code}</>}
        {candidate.detail && <> · {candidate.detail}</>}</p>
    </div>)}
    {selection.paths.length > 0 && <button type="button" onClick={() => selection.clear()}>Clear selected paths</button>}
    {selection.capable ? <>
      {!inventory && <p>Pending inventory has not been read. Refresh to view Runner-owned references.</p>}
      <p>Remove references in /files, then refresh here. Registration keeps sources live until Runner uses them; it does not confirm Agent consumption.</p>
    </> : <p>Selected paths are not confirmed attachments. This Runner offers the manual /files flow without registration receipts or inventory.</p>}
    {error && <p role="alert">{error}</p>}
    {selection.error && <p role="alert">{selection.error}</p>}
  </details>;
}

function referenceState(state: string) {
  switch (state) {
    case 'selected': return 'Selected · unregistered';
    case 'sending': return 'Submitting · admission unconfirmed';
    case 'queued': return 'Queued · registration unconfirmed';
    case 'pending-interaction': return 'Pending terminal interaction · select image detail or cancel in this Runner terminal';
    case 'registered': return 'Registered · completed Runner receipt';
    case 'rejected': return 'Rejected · no registration confirmed';
    case 'failure': return 'Failed · no registration confirmed';
    case 'outcome-unknown': return 'Outcome unknown · not repeated. Reconcile in /files or refresh inventory; names cannot identify this attempt.';
    default: return state;
  }
}
