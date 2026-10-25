import { useState } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed } from './runnerControl';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting;
  const [error, setError] = useState('');
  const available = session.view.status === 'running' && session.view.canSubmit && !session.assignmentReserved;
  const files = commandNamed(session.control.snapshot, '/files');
  const canSelect = session.control.snapshot.state === 'ready' && !!files?.enabled && !session.control.busy;
  async function pick(folder: boolean) {
    setError('');
    try { await session.references.choose(folder); }
    catch (reason) { setError(String(reason)); }
  }
  async function submit() {
    setError('');
    try { await session.submit(); }
    catch (reason) { setError(String(reason)); }
  }
  return <section className="composer-area" aria-label="Instruction composer">
    <div className="composer">
      <textarea aria-label="Runner instructions" value={text} rows={3} disabled={!available || pending}
        placeholder="Text or a Runner command…" onChange={event => session.setDraft(event.target.value)} />
      <div className="composer-actions"><div className="attachments">
        <button type="button" disabled={!canSelect} aria-label="Attach file" title={files?.disabled_reason || 'Choose a path for the terminal /files flow'}
          onClick={() => void pick(false)}>＋ <span>Attach file</span></button>
        <button type="button" disabled={!canSelect} aria-label="Attach folder" title={files?.disabled_reason || 'Choose a folder for the terminal /files flow'}
          onClick={() => void pick(true)}>▱ <span>Folder</span></button>
      </div><button type="button" className="send-button" aria-label="Send instruction" disabled={!available || pending || !text}
        onClick={() => void submit()}>{pending ? 'Sending…' : 'Send instruction'} <span aria-hidden="true">↗</span></button></div>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="composer-note">{pending ? 'Sending this input to the selected terminal…'
      : session.assignmentReserved ? 'Single Entry holds this Runner. Review the assignment in Single Entry before using this composer.' : session.view.status === 'running'
      ? available ? 'Appends to this terminal’s current input, then presses Enter. Line breaks stay within one submission.'
        : 'Waiting for the terminal input protocol. You can type directly in the terminal.'
      : 'This Runner process is not running.'}</p>
  </section>;
}
