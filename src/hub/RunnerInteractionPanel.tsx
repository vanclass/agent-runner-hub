import { useState } from 'react';
import { t, tr, useHubTranslation } from './i18n';
import type { RunnerInteraction, InteractionView } from './RunnerInteraction';
import type { ControlResult } from './runnerControl';
import './runnerInteraction.css';

export function RunnerInteractionPanel({ interaction, results }: { interaction: RunnerInteraction; results: ControlResult[] }) {
  useHubTranslation();
  const view = interaction.view;
  const compact = view?.state !== 'active' && !interaction.detail && !results.length;
  return <section className={`runner-interaction${compact ? ' compact' : ''}`} aria-label={t('interaction.label')}>
    <h3>{t('interaction.label')}</h3>
    {interaction.detail && <p role="status">{tr(interaction.detail)}</p>}
    {view?.state === 'active' ? <InteractionActions key={view.interaction_id} interaction={interaction} view={view} />
      : <p role="status">{t(interaction.state === 'ready' ? view?.state === 'none' ? 'interaction.none'
        : view?.state === 'unsupported' ? 'interaction.unsupported' : 'interaction.observing'
        : interaction.state === 'unsupported' ? 'interaction.unsupported'
        : interaction.state === 'disconnected' ? 'interaction.disconnected' : 'interaction.observing')}
        {view?.state === 'unsupported' && view.code && <span> ({view.code})</span>}</p>}
    {interaction.busy && <p role="status">{t('interaction.pending')}</p>}
    {results.map(result => <p key={result.id} role="status">{t('interaction.commandResult')}: {result.command} — {result.state}
      {result.ownerStatus && ` (${result.ownerStatus})`}{result.code && ` [${result.code}]`}</p>)}
  </section>;
}
function InteractionActions({ interaction, view }: { interaction: RunnerInteraction; view: Extract<InteractionView, { state: 'active' }> }) {
  const [text, setText] = useState('');
  const enabled = interaction.canRespond(view);
  const action = view.kind === 'confirmation' ? 'confirm' : 'select';
  return <div>
    <h4>{view.prompt}</h4>
    {view.context && <p className="interaction-context">{view.context}</p>}
    {view.consequences?.map((consequence, index) => <div className="interaction-consequence" key={index}>
      <strong>{consequence.text}</strong><span> ({consequence.role})</span>
      {consequence.details.map((detail, i) => <p key={i}>{detail}</p>)}
    </div>)}
    {view.kind !== 'text' && <ul>{view.choices.map(choice => <li key={choice.choice_id}>
      <button type="button" disabled={!enabled || !choice.enabled || !view.actions.includes(action)}
        onClick={() => interaction.respond(view, action, choice.choice_id)}>{choice.label}</button>
      {choice.description && <p>{choice.description}</p>}
      {!choice.enabled && <p>{choice.disabled_reason}</p>}
    </li>)}</ul>}
    {view.kind === 'text' && <form onSubmit={event => { event.preventDefault(); interaction.respond(view, 'text', text); }}>
      <label>{view.prompt}<input aria-label={view.prompt} value={text} disabled={!enabled} required={view.text_input?.required}
        onChange={event => setText(event.target.value)} /></label>
      <button type="submit" disabled={!enabled || !view.actions.includes('text')}>{t('interaction.submit')}</button>
    </form>}
    <div className="interaction-navigation">{(['back', 'cancel'] as const).filter(action => view.actions.includes(action)).map(action =>
      <button type="button" key={action} disabled={!enabled} onClick={() => interaction.respond(view, action)}>{t(action === 'back' ? 'interaction.back' : 'interaction.cancel')}</button>)}</div>
  </div>;
}
