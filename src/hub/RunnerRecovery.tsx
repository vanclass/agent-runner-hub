import { useState } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed } from './runnerControl';

export function RunnerRecovery({ session }: { session: RunnerSession }) {
  const [error, setError] = useState('');
  if (!session.restored) return null;
  const { control, previousContext, view } = session;
  const command = commandNamed(control.snapshot, '/recover');
  const last = control.snapshot.results.filter(result => result.command === '/recover').at(-1);
  const ready = view.status === 'running' && control.observationFresh;
  const reason = view.status === 'failed' ? 'Recovery unavailable: check the Runner launch error below.'
    : view.status === 'exited' ? 'Recovery unavailable: this Runner process has ended.'
      : control.snapshot.state === 'disconnected' ? 'Recovery unavailable: Runner control is disconnected.'
        : !ready ? 'Waiting for a fresh Runner control connection.'
    : !command ? 'Recovery is not offered by this Runner.'
      : control.busy ? 'Finish the interaction in this Runner terminal.'
        : !command.enabled ? command.disabled_reason || 'Recovery is currently unavailable.' : '';
  async function recover() {
    setError('');
    try { await control.command('/recover'); }
    catch (reason) { setError(String(reason)); }
  }
  return <section className="runner-recovery context-settings" aria-label="Restored Runner recovery">
    <p><strong>Restored workspace.</strong> {view.status === 'running' ? 'Fresh Runner process started.'
      : view.status === 'starting' ? 'Creating a fresh Runner process…'
        : view.status === 'failed' ? 'Runner launch failed.' : 'Previous process ended; no process was restored.'}
      {' '}Historical work recovery is unconfirmed.</p>
    {previousContext && <p className="scope-note">Historical target: {previousContext.target.owner || 'Unbound'}
      {previousContext.target.project && ` / ${previousContext.target.project}`}.
      {` Binding: ${previousContext.target.binding_state}.`}
      {previousContext.runMode && ` Previous run mode: ${previousContext.runMode}.`}
      {previousContext.workflowKind && ` Previous workflow: ${previousContext.workflowKind}.`}
      {' '}Previous process context only; current settings below come from this Runner.</p>}
    <button type="button" className="command-button" disabled={!!reason} title={reason || command?.description} onClick={() => void recover()}>
      Recover earlier work</button>
    <p role="status">{last ? `/recover: ${last.state}${last.code ? ` (${last.code})` : ''}. ` : ''}
      {reason || 'Runner discovers recovery candidates. Select and confirm in this terminal.'}
      {last?.state === 'accepted' && ' Runner completed the command; its terminal owns the work recovery outcome.'}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
