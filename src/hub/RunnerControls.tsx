import { useHubTranslation, t, tr, msg, errorText, type HubText, type MessageKey } from './i18n';
import { useState } from 'react';
import type { RunnerControl, RunnerCommand } from './runnerControl';

const primaryLabels: Record<string, MessageKey> = { '/status': 'panel.status', '/target': 'fields.target',
  '/model': 'fields.model', '/account': 'fields.account', '/run-mode': 'fields.runMode', '/resume': 'panel.resume' };

const outcomeText = {
  sending: msg('control.outcome.sending'), queued: msg('control.outcome.queued'),
  'pending-interaction': msg('control.outcome.interaction'),
  accepted: msg('control.outcome.accepted'), rejected: msg('control.outcome.rejected'),
  failure: msg('control.outcome.failure'), 'outcome-unknown': msg('control.outcome.unknown'),
};
export function RunnerControls({ control }: { control: RunnerControl }) {
  const [customizing, setCustomizing] = useState(false);
  useHubTranslation();
  const [error, setError] = useState<HubText>('');
  const { snapshot } = control;
  const observation = snapshot.observation;
  const selection = observation?.selection;
  const connected = snapshot.state === 'ready';
  async function run(command: RunnerCommand) {
    setError('');
    try { await control.command(command.text); }
    catch (reason) { setError(errorText(reason)); }
  }
  const commands = control.shortcuts();
  const primary = new Set(control.order.length
    ? commands.slice(0, Object.keys(primaryLabels).length).map(command => command.text) : Object.keys(primaryLabels));
  function renderCommand(command: RunnerCommand) {
    return <span className="shortcut" key={`${command.parent_id}/${command.id}`}>
      <button type="button" disabled={!connected || control.busy || !command.enabled}
        title={command.disabled_reason || command.description} onClick={() => void run(command)}>
        {primaryLabels[command.text] && <span>{t(primaryLabels[command.text])} </span>}<code>{command.text}</code>
      </button>
      {!command.enabled && <small>{command.disabled_reason}</small>}
    </span>;
  }
  const last = snapshot.results.at(-1);
  const completed = last && ['accepted', 'rejected', 'failure'].includes(last.state);
  const acknowledgement = completed ? [last.ownerStatus === 'CANCELLED' ? t('control.cancelled') : '',
    last.changed === false ? t('control.unchanged') : last.changed === true ? t('control.changed') : '',
    typeof last.settingsChangeCount === 'number' ? t('control.changeCount', { count: last.settingsChangeCount }) : ''].filter(Boolean).join(' · ') : '';
  return <section className="context-settings runner-controls" aria-label={t('control.settings')}>
    <h2>{t('panel.commands')}</h2>
    <p className="scope-note">{t('control.menuHelp')}</p>
    <div className="shortcut-bar" aria-label={t('control.shortcutsLabel')}>{commands.filter(command =>
      primary.has(command.text) && !control.hidden.has(command.text)).map(renderCommand)}</div>
    {commands.some(command => !primary.has(command.text) && !control.hidden.has(command.text)) &&
      <details className="more-commands"><summary>{t('panel.moreCommands')}</summary>
        <div className="shortcut-bar">{commands.filter(command => !primary.has(command.text)
          && !control.hidden.has(command.text)).map(renderCommand)}</div>
      </details>}
    <button type="button" className="command-button" aria-expanded={customizing}
      onClick={() => setCustomizing(value => !value)}>{t('control.shortcuts')}</button>
    {customizing && <div className="shortcut-editor" aria-label={t('control.customize')}>
      <p>{t('control.visibilityHelp')}</p>
      {commands.map((command, index) => <div className="shortcut-editor-row" key={`${command.parent_id}/${command.id}`}>
        <label><input type="checkbox" checked={!control.hidden.has(command.text)}
          onChange={event => control.show(command.text, event.target.checked)} />{command.text}</label>
        <button type="button" aria-label={t('control.moveUp', { command: command.text })} disabled={index === 0} onClick={() => control.move(command.text, -1)}>↑</button>
        <button type="button" aria-label={t('control.moveDown', { command: command.text })} disabled={index === commands.length - 1} onClick={() => control.move(command.text, 1)}>↓</button>
        {!command.enabled && <small>{command.disabled_reason}</small>}
      </div>)}
    </div>}
    <p className="control-status" role="status">{snapshot.state === 'connecting' ? t('control.connecting')
      : !connected ? t('control.disconnected', { detail: snapshot.detail ?? '', last: last ? ` ${last.command}: ${tr(outcomeText[last.state])}` : '' })
        : control.sending ? t('control.sending') : last ? `${last.command}: ${tr(outcomeText[last.state])}${last.code ? ` (${last.code})` : ''}`
          : observation?.attention.foreground_interaction_active ? t('control.interacting') : t('control.connected')}</p>
    {error && <p role="alert" className="runner-error">{tr(error)}</p>}
    {acknowledgement && <p className="scope-note">{acknowledgement}</p>}
    {observation && selection && <details className="terminal-observation" open={!control.config.actual}>
      <summary>{t('panel.observation')}</summary>
      <dl>
        <dt>{t('fields.target')}</dt><dd data-field="target">{observation.target.owner} / {observation.target.project}</dd>
        <dt>{t('fields.account')}</dt><dd data-field="account">{selection.account}</dd>
        <dt>{t('fields.runMode')}</dt><dd data-field="runMode">{observation.run_mode}</dd>
      </dl>
      <p>{t('config.effective', { model: selection.model, effort: selection.reasoning_effort, tier: selection.service_tier })}</p>
      <p>{t('config.next', { model: selection.next_model, effort: selection.next_reasoning_effort, tier: selection.next_service_tier })}</p>
    </details>}
  </section>;
}
