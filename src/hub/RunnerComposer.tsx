import { useState } from 'react';
import type { RunnerSession } from './RunnerSessions';

export function RunnerComposer({ session }: { session: RunnerSession }) {
  const text = session.view.draft ?? '';
  const pending = !!session.view.submitting;
  const [error, setError] = useState('');
  const available = session.view.status === 'running' && session.view.canSubmit;
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
        <button type="button" disabled aria-label="Attach file">＋ <span>Attach file</span></button>
        <button type="button" disabled aria-label="Attach folder">▱ <span>Folder</span></button>
      </div><button type="button" className="send-button" aria-label="Send instruction" disabled={!available || pending || !text}
        onClick={() => void submit()}>{pending ? 'Sending…' : 'Send instruction'} <span aria-hidden="true">↗</span></button></div>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="composer-note">{pending ? 'Sending this input to the selected terminal…' : session.view.status === 'running'
      ? available ? 'Appends to this terminal’s current input, then presses Enter. Line breaks stay within one submission.'
        : 'Waiting for the terminal input protocol. You can type directly in the terminal.'
      : 'This Runner process is not running.'}</p>
  </section>;
}
