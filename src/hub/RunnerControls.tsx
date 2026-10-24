import { useState } from 'react';
import type { RunnerControl, RunnerCommand } from './runnerControl';
import { commandNamed } from './runnerControl';

const outcomeText = {
  sending: 'Sending command', queued: 'Queued · no completed change yet',
  'pending-interaction': 'Waiting for answers or confirmation in this Runner terminal',
  accepted: 'Completed · accepted by Runner', rejected: 'Completed · rejected by Runner',
  failure: 'Command failed', 'outcome-unknown': 'Outcome unknown · not retried',
};
export function RunnerControls({ control }: { control: RunnerControl }) {
  const [customizing, setCustomizing] = useState(false);
  const [error, setError] = useState('');
  const { snapshot } = control;
  const observation = snapshot.observation;
  const connected = snapshot.state === 'ready';
  const waiting = snapshot.state === 'connecting' ? 'Waiting for Runner' : 'Unavailable';
  async function run(command: RunnerCommand) {
    setError('');
    try { await control.command(command.text); }
    catch (reason) { setError(String(reason)); }
  }
  const selection = observation?.selection;
  const settings = [
    { label: 'Project / Target', command: '/target', value: observation
      ? `${observation.target.owner || 'Unbound'}${observation.target.project ? ` / ${observation.target.project}` : ''}` : waiting,
      detail: observation?.target.binding_state },
    { label: 'Model', command: '/model', value: selection?.model ?? waiting,
      detail: selection ? `Effective: ${selection.reasoning_effort} · ${selection.service_tier}` : '' },
    { label: 'Account', command: '/account', value: selection ? selection.account || 'Not selected' : waiting, detail: '' },
    { label: 'Run Mode', command: '/run-mode', value: observation?.run_mode ?? waiting, detail: '' },
  ];
  const nextDiffers = selection && (selection.model !== selection.next_model
    || selection.reasoning_effort !== selection.next_reasoning_effort || selection.service_tier !== selection.next_service_tier);
  const commands = control.shortcuts();
  const last = snapshot.results.at(-1);
  return <section className="context-settings runner-controls" aria-label="Selected Runner settings">
    <div className="settings-grid">{settings.map(setting => {
      const command = commandNamed(snapshot, setting.command);
      const reason = !connected ? 'Runner control is unavailable' : control.busy ? 'Finish the current terminal interaction'
        : command?.disabled_reason || (!command ? 'Not offered by this Runner' : '');
      return <div className="setting" key={setting.label}><span>{setting.label}</span>
        <button type="button" aria-label={`Change Runner ${setting.label}`} title={reason || `Open ${setting.command} in Runner`}
          disabled={!connected || control.busy || !command?.enabled} onClick={() => command && void run(command)}>
          {setting.value}</button><small>{setting.detail || reason}</small></div>;
    })}<button type="button" className="command-button" aria-expanded={customizing}
      onClick={() => setCustomizing(value => !value)}>Shortcuts</button></div>
    {selection && <p className="scope-note">Settings source: {selection.source}.
      {nextDiffers && ` Next configured: ${selection.next_model} · ${selection.next_reasoning_effort} · ${selection.next_service_tier}.`}
      {' '}Changes open Runner menus; answer in its terminal.</p>}
    <div className="shortcut-bar" aria-label="Runner command shortcuts">{commands.filter(command => !control.hidden.has(command.text)).map(command =>
      <span className="shortcut" key={`${command.parent_id}/${command.id}`}>
        <button type="button" disabled={!connected || control.busy || !command.enabled} title={command.disabled_reason || command.description}
          onClick={() => void run(command)}>{command.text}</button>
        {!command.enabled && <small>{command.disabled_reason}</small>}
      </span>)}</div>
    {customizing && <div className="shortcut-editor" aria-label="Customize shortcuts">
      <p>Visibility and order apply to this Hub session only.</p>
      {commands.map((command, index) => <div className="shortcut-editor-row" key={`${command.parent_id}/${command.id}`}>
        <label><input type="checkbox" checked={!control.hidden.has(command.text)}
          onChange={event => control.show(command.text, event.target.checked)} />{command.text}</label>
        <button type="button" aria-label={`Move ${command.text} up`} disabled={index === 0} onClick={() => control.move(command.text, -1)}>↑</button>
        <button type="button" aria-label={`Move ${command.text} down`} disabled={index === commands.length - 1} onClick={() => control.move(command.text, 1)}>↓</button>
        {!command.enabled && <small>{command.disabled_reason}</small>}
      </div>)}
    </div>}
    <p className="control-status" role="status">{snapshot.state === 'connecting' ? 'Connecting to Runner…'
      : !connected ? `Control disconnected · displayed settings may be stale. ${snapshot.detail ?? ''}${last ? ` ${last.command}: ${outcomeText[last.state]}` : ''}`
        : control.sending ? 'Sending command…' : last ? `${last.command}: ${outcomeText[last.state]}${last.code ? ` (${last.code})` : ''}`
          : observation?.attention.foreground_interaction_active ? 'Runner is waiting for interaction in its terminal.' : 'Runner settings connected'}</p>
    {error && <p role="alert" className="runner-error">{error}</p>}
  </section>;
}
