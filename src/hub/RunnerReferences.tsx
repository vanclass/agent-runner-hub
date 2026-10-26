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
  const pending = selection.pendingSet ?? inventory?.references;
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
        <button type="button" disabled={!available || !selection.candidates.some(item => item.source !== 'clipboard' && selection.state(item) === 'staged')}
          onClick={() => void selection.registerSelected()}>Register selected paths</button>
        <button type="button" disabled={!available} onClick={() => void selection.refresh()}>Reconcile pending references</button>
      </>}
    </div>
    {selection.staging && <p role="status">Reading clipboard and staging PNG for this Runner…</p>}
    {(selection.registering || selection.listing) && <p role="status">{foreground
      ? 'Continue in this Runner terminal: select image detail or cancel the pending interaction.'
      : selection.listing ? 'Reading Runner inventory…' : 'Registering paths with this Runner…'}</p>}
    <p>{selection.capable ? 'Choose or drop files and folders to register them with this Runner. Image detail and cancellation stay in its terminal.'
      : 'Choose or drop paths here, then use /files → Add → Direct input in the terminal. Copy the path below into that flow.'}</p>
    {selection.capable && pending && <section aria-label="Registered pending references">
      <h3>Registered pending references</h3>
      {control.snapshot.state !== 'ready' && <p role="status">Last inventory sample · Runner unavailable. References are not restored into another process.</p>}
      <p>{selection.pendingSet ? pending.length : inventory?.total_count} pending · {selection.pendingSet
        ? 'Matching complete inventory samples. Send verifies again.' : 'Last receipt page. Reconcile to review the complete pending set.'}</p>
      {pending.length === 0 && <p>No pending references in this sample.</p>}
      <ol>{pending.map(reference => <li key={reference.reference_id}>
        {reference.display_name} · {reference.kind}{reference.image_detail && ` · Detail: ${reference.image_detail}`}{reference.media_kind && ` · ${reference.media_kind}`}
        <br /><code>{reference.reference_id}</code>
      </li>)}</ol>
    </section>}
    {selection.otherPending.length > 0 && <section aria-label="Other pending references">
      <h3>Other pending references</h3>
      <p>These references were already pending in this Runner and will also accompany the instruction.</p>
      <ul>{selection.otherPending.map(reference => <li key={reference.reference_id}>
        {reference.display_name} · <code>{reference.reference_id}</code>
      </li>)}</ul>
      <button type="button" disabled={selection.locked} onClick={() => selection.reviewOtherPending()}>Include other pending references</button>
    </section>}
    {selection.candidates.length > 0 && <h3>Attachments and receipts</h3>}
    {selection.candidates.map(candidate => <div className="reference-candidate" key={candidate.key}>
      {candidate.source === 'clipboard' ? <div className="clipboard-candidate">
        {candidate.thumbnail && <img src={candidate.thumbnail} alt={`Clipboard image ${candidate.key} preview`} width="80" height="60" />}
        <strong>Clipboard image {candidate.key}</strong>
      </div> : <label className="reference-path">Selected path
        <input aria-label={`Selected path ${candidate.path}`} readOnly value={candidate.path} onFocus={event => event.currentTarget.select()} /></label>}
      <p role="status">{candidate.submitted ? 'Delivered to PTY · workload acceptance unconfirmed' : referenceState(selection.state(candidate))}
        {selection.referenceId(candidate) && <> · Reference ID: <code>{selection.referenceId(candidate)}</code></>}
        {selection.result(candidate)?.code && <> · {selection.result(candidate)!.code}</>}
        {candidate.cancelRequested && !['removed', 'cancelled'].includes(selection.state(candidate)) && <> · Cancellation requested; awaiting authoritative resolution</>}
        {candidate.detail && <> · {candidate.detail}</>}</p>
      {!candidate.submitted && !['removed', 'cancelled'].includes(selection.state(candidate)) && <button type="button"
        disabled={selection.locked || control.assignmentLocked || candidate.cancelRequested}
        onClick={() => void selection.cancel(candidate.key)}>
        {selection.referenceId(candidate) ? 'Remove' : 'Cancel'} {candidate.source === 'clipboard' ? 'image' : 'path'} {candidate.key}
      </button>}
    </div>)}
    {selection.candidates.length > 0 && <button type="button" disabled={selection.locked}
      title="Clears submitted, removed and cancelled display history. Live attachments and uncertain receipts stay visible."
      onClick={() => selection.clearHistory()}>Clear registration history</button>}
    {selection.locked && <p role="status">Attachment selection locked for this instruction. Complete or cancel image-detail prompts in the Runner terminal.</p>}
    {selection.capable ? <>
      {!pending && <p>Pending inventory has not been read. Reconcile to view Runner-owned references.</p>}
      <p>Clipboard images stay staged until Send. Cancel individual images before sending. {selection.removable
        ? 'Registered items are removed by their committed ID.'
        : 'This Runner requires /files → Remove, then Reconcile pending references for registered items.'} Sources remain live until the owning session ends.</p>
    </> : <p>Selected paths are not confirmed attachments. Use this Runner’s manual /files flow.</p>}
    {error && <p role="alert">{error}</p>}
    {selection.error && <p role="alert">{selection.error}</p>}
  </details>;
}

function referenceState(state: string) {
  switch (state) {
    case 'capturing': return 'Capturing clipboard image…';
    case 'staged': return 'Staged · unregistered';
    case 'registering': return 'Submitting · admission unconfirmed';
    case 'removing': return 'Removing · awaiting completed Runner receipt';
    case 'removed': return 'Removed · owning Runner confirmed absence';
    case 'cancelled': return 'Cancelled · no pending attachment';
    case 'queued': return 'Queued · registration unconfirmed';
    case 'pending-interaction': return 'Pending terminal interaction · select image detail or cancel in this Runner terminal';
    case 'registered': return 'Registered · completed Runner receipt';
    case 'rejected': return 'Rejected · no registration confirmed';
    case 'failed': return 'Failed · review or cancel this item before sending';
    case 'outcome-unknown': return 'Outcome unknown · not repeated. Reconcile in /files or refresh inventory; names cannot identify this attempt.';
    default: return state;
  }
}
