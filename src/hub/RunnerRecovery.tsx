import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useState } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed } from './runnerControl';

export function RunnerRecovery({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const [error, setError] = useState<HubText>('');
  if (!session.restored) return null;
  const { control, previousContext, view } = session;
  const command = commandNamed(control.snapshot, '/recover');
  const last = control.snapshot.results.filter(result => result.command === '/recover').at(-1);
  const ready = view.status === 'running' && control.observationFresh;
  const reason = view.status === 'failed' ? t('recovery.launchFailed')
    : view.status === 'exited' ? t('recovery.ended')
      : control.snapshot.state === 'disconnected' ? t('recovery.disconnected')
        : !ready ? t('recovery.waiting')
    : !command ? t('recovery.notOffered')
      : control.busy ? t('recovery.finish')
        : !command.enabled ? command.disabled_reason || t('recovery.unavailable') : '';
  async function recover() {
    setError('');
    try { await control.command('/recover'); }
    catch (reason) { setError(errorText(reason)); }
  }
  return <section className="runner-recovery context-settings" aria-label={t('recovery.label')}>
    <p><strong>{t('recovery.restored')}</strong> {view.status === 'running' ? t('recovery.fresh')
      : view.status === 'starting' ? t('recovery.creating')
        : view.status === 'failed' ? t('recovery.failed') : t('recovery.previousEnded')}
      {' '}{t('recovery.unconfirmed')}</p>
    {previousContext && <p className="scope-note">{t('recovery.target', { owner: previousContext.target.owner || t('common.unbound') })}
      {previousContext.target.project && ` / ${previousContext.target.project}`}.
      {t('recovery.binding', { binding: previousContext.target.binding_state })}
      {previousContext.runMode && t('recovery.mode', { mode: previousContext.runMode })}
      {previousContext.workflowKind && t('recovery.workflow', { workflow: previousContext.workflowKind })}
      {' '}{t('recovery.contextHelp')}</p>}
    <button type="button" className="command-button" disabled={!!reason} title={reason || command?.description} onClick={() => void recover()}>
      {t('recovery.recover')}</button>
    <p role="status">{last ? `/recover: ${last.state}${last.code ? ` (${last.code})` : ''}. ` : ''}
      {reason || t('recovery.discovery')}
      {last?.state === 'accepted' && t('recovery.commandCompleted')}</p>
    {error && <p role="alert">{tr(error)}</p>}
  </section>;
}
