import { useHubTranslation, t, tr, msg, errorText, type HubText } from './i18n';
import { useState } from 'react';
import type { RunnerControl, RunnerCommand } from './runnerControl';
import { commandNamed } from './runnerControl';
import { RunnerConfigPanel } from './RunnerConfigPanel';
import type { EntryDefaults } from './singleEntry';

const outcomeText = {
  sending: msg('control.outcome.sending'), queued: msg('control.outcome.queued'),
  'pending-interaction': msg('control.outcome.interaction'),
  accepted: msg('control.outcome.accepted'), rejected: msg('control.outcome.rejected'),
  failure: msg('control.outcome.failure'), 'outcome-unknown': msg('control.outcome.unknown'),
};
export function RunnerControls({ control, defaults }: { control: RunnerControl; defaults?: EntryDefaults }) {
  const [customizing, setCustomizing] = useState(false);
  useHubTranslation();
  const [error, setError] = useState<HubText>('');
  const { snapshot } = control;
  const observation = snapshot.observation;
  const connected = snapshot.state === 'ready';
  const waiting = snapshot.state === 'connecting' ? t('control.waiting') : t('common.unavailable');
  async function run(command: RunnerCommand) {
    setError('');
    try { await control.command(command.text); }
    catch (reason) { setError(errorText(reason)); }
  }
  const selection = observation?.selection;
  const settings = [
    { label: t('fields.target'), command: '/target', value: observation
      ? `${observation.target.owner || t('common.unbound')}${observation.target.project ? ` / ${observation.target.project}` : ''}` : waiting,
      detail: observation?.target.binding_state },
    { label: t('fields.model'), command: '/model', value: selection?.model ?? waiting,
      detail: selection ? t('control.effective', { effort: selection.reasoning_effort, tier: selection.service_tier }) : '' },
    { label: t('fields.account'), command: '/account', value: selection ? selection.account || t('common.notSelected') : waiting, detail: '' },
    { label: t('fields.runMode'), command: '/run-mode', value: observation?.run_mode ?? waiting, detail: '' },
  ];
  const nextDiffers = selection && (selection.model !== selection.next_model
    || selection.reasoning_effort !== selection.next_reasoning_effort || selection.service_tier !== selection.next_service_tier);
  const commands = control.shortcuts();
  const last = snapshot.results.at(-1);
  const completed = last && ['accepted', 'rejected', 'failure'].includes(last.state);
  const acknowledgement = completed ? [last.ownerStatus === 'CANCELLED' ? t('control.cancelled') : '',
    last.changed === false ? t('control.unchanged') : last.changed === true ? t('control.changed') : '',
    typeof last.settingsChangeCount === 'number' ? t('control.changeCount', { count: last.settingsChangeCount }) : ''].filter(Boolean).join(' · ') : '';
  return <section className="context-settings runner-controls" aria-label={t('control.settings')}>
    <div className="settings-grid">{settings.map(setting => {
      const command = commandNamed(snapshot, setting.command);
      const reason = !connected ? t('control.unavailable') : control.busy ? t('control.finishCurrent')
        : command?.disabled_reason || (!command ? t('control.notOffered') : '');
      return <div className="setting" key={setting.label}><span>{setting.label}</span>
        <button type="button" aria-label={t('control.changeField', { field: setting.label })} title={reason || t('control.openCommand', { command: setting.command })}
          disabled={!connected || control.busy || !command?.enabled} onClick={() => command && void run(command)}>
          {setting.value}</button><small>{setting.detail || reason}</small></div>;
    })}<button type="button" className="command-button" aria-expanded={customizing}
      onClick={() => setCustomizing(value => !value)}>{t('control.shortcuts')}</button></div>
    {selection && <p className="scope-note">{t('control.source', { source: selection.source })}
      {nextDiffers && t('control.next', { model: selection.next_model, effort: selection.next_reasoning_effort, tier: selection.next_service_tier })}
      {' '}{t('control.menuHelp')}</p>}
    <div className="shortcut-bar" aria-label={t('control.shortcutsLabel')}>{commands.filter(command => !control.hidden.has(command.text)).map(command =>
      <span className="shortcut" key={`${command.parent_id}/${command.id}`}>
        <button type="button" disabled={!connected || control.busy || !command.enabled} title={command.disabled_reason || command.description}
          onClick={() => void run(command)}>{command.text}</button>
        {!command.enabled && <small>{command.disabled_reason}</small>}
      </span>)}</div>
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
    <RunnerConfigPanel control={control} defaults={defaults} />
  </section>;
}
