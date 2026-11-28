import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t, tr, useHubTranslation } from './i18n';
import { DirectoryInput } from './DirectoryInput';
import { runModeLabel } from './runModeLabel';
import { same, validDesired, type ConfigAccount, type ConfigCatalog, type ConfigDesired, type ConfigModelOption } from './runnerConfigContract';
import type { RunnerSession } from './RunnerSessions';
import type { RunnerQuickConfig } from './RunnerQuickConfig';
import './runnerQuickSettings.css';

type Field = 'provider' | 'account' | 'model' | 'reasoning' | 'mode' | 'location';
const direct = (mode?: string) => mode === 'direct-run' || mode === 'pure-direct-run';

export function RunnerQuickSettings({ session }: { session: RunnerSession }) {
  useHubTranslation();
  const { control, quick } = session, { config } = control;
  const observation = control.snapshot.state === 'ready' ? control.snapshot.observation : undefined;
  const effective = observation?.selection, location = observation?.context_location;
  const [field, setField] = useState<Field>();
  const opening = useRef(0);
  const [directory, setDirectory] = useState<{ mode?: string; value: string }>();
  const [account, setAccount] = useState<ConfigAccount>();
  const [modelDraft, setModelDraft] = useState<{ model: ConfigModelOption; effort: string; tier: string }>();
  const anchor = useRef<HTMLButtonElement>();
  const panel = useRef<HTMLDivElement>(null);
  const pending = config.busy || quick.interactionBusy;
  const catalog = config.currentCatalog;
  const current = catalog?.inspection.current;
  const related = catalog && same(catalog.inspection.model_options_account, current?.account)
    && current?.account.agent_id === effective?.agent_id && current?.account.profile_name === effective?.account;
  const advertised = related ? catalog.options.models.find(m => m.id === effective?.model) : undefined;
  const nextTier = effective?.service_tier === 'fast' ? 'default' : 'fast';
  const fastSupported = !!advertised?.service_tiers.includes('fast');
  const canEdit = !!effective?.agent_id && effective.agent_id !== 'none'
    && quick.available && config.supports('plan') && config.supports('apply');
  const configReason = canEdit ? '' : t(pending ? 'config.inspecting' : 'quick.unavailable');
  const supported = (key: string) => catalog?.inspection.availability[key] !== false;
  const providers = config.providerOutcomeUnknown ? undefined : config.providers;
  const providerLabel = providers?.providers.find(p => p.agent_id === effective?.agent_id)?.label
    ?? (effective?.agent_id === 'codex' ? 'Codex' : effective?.agent_id === 'claude' ? 'Claude'
      : effective?.agent_id === 'none' ? t('config.providerNone') : effective?.agent_id);
  const root = location?.kind === 'direct_root' ? location.path : '';
  const locationLabel = location?.kind === 'target' ? location.label
    : location?.kind === 'direct_root' ? root : observation?.target.project;
  const activeContext = direct(observation?.run_mode);

  function close(restoreFocus = false) {
    opening.current++;
    setField(undefined); setAccount(undefined); setDirectory(undefined); setModelDraft(undefined);
    if (restoreFocus) anchor.current?.focus();
  }

  useLayoutEffect(() => { close(); }, [config.providerRevision, effective?.account]);

  useLayoutEffect(() => {
    const popup = panel.current, trigger = anchor.current;
    if (!field || !popup || !trigger) return;
    const place = () => {
      const { left, top } = trigger.getBoundingClientRect();
      const width = popup.offsetWidth;
      popup.style.left = Math.max(8, Math.min(left, window.innerWidth - width - 8)) + 'px';
      popup.style.bottom = Math.max(8, window.innerHeight - top + 5) + 'px';
      popup.style.maxHeight = Math.max(44, top - 14) + 'px';
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !trigger.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(true); }
    };
    place();
    popup.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', dismiss);
    popup.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', dismiss);
      popup.removeEventListener('keydown', escape);
    };
  }, [field]);

  function selectField(key: Field, button: HTMLButtonElement) {
    if (field === key) { close(true); return; }
    close();
    anchor.current = button; setField(key);
    if (key === 'location' && activeContext) setDirectory({ value: root });
  }

  const label = (key: Field) => ({
    provider: t('quick.provider'), account: t('fields.account'), model: t('fields.model'),
    reasoning: t('config.reasoning'), mode: t('fields.runMode'),
    location: activeContext ? t('config.root') : t('fields.target'),
  })[key];

  function button(key: Field, effectiveValue?: string) {
    const value = effectiveValue || t('quick.unset');
    const name = t('quick.value', { field: label(key), value });
    const operation = key === 'provider' ? 'providers' : 'inspect';
    const reason = !config.supports(operation) ? t('config.unsupported') : '';
    const disabled = field !== key && (!!reason || pending || control.busy || !effective?.agent_id
      || (key !== 'provider' && effective.agent_id === 'none'));
    return <button type="button" aria-haspopup="dialog" aria-expanded={field === key} aria-label={name}
      aria-disabled={disabled} title={reason ? name + ' · ' + reason : disabled && configReason ? name + ' · ' + configReason : name}
      onClick={event => { if (!disabled) selectField(key, event.currentTarget); }}>{value}</button>;
  }

  function apply(desired: ConfigDesired, reasoningAccount?: ConfigAccount) {
    close(true);
    void quick.change(desired, reasoningAccount);
  }

  function option(key: string, text: string, selected: boolean, accept: () => void, reason = '') {
    const disabled = !!reason || !quick.available || pending || (field !== 'provider' && !canEdit);
    return <button key={key} type="button" className="quick-option" aria-current={selected}
      aria-disabled={disabled} title={reason || text} onClick={() => { if (!disabled && quick.available) accept(); }}>
      <span aria-hidden="true">{selected ? '✓' : ''}</span><span>{text}{reason && <small>{reason}</small>}</span>
    </button>;
  }

  function selectModel(model: ConfigModelOption, current: ConfigCatalog['inspection']['current'], destination?: ConfigAccount) {
    const effort = model.reasoning_efforts.includes(current.model.reasoning_effort) ? current.model.reasoning_effort : '';
    const tier = model.service_tiers.includes(current.service_tier) ? current.service_tier : '';
    if (effort && tier) apply({ ...(destination && { account: destination }), model: { id: model.id, reasoning_effort: effort } });
    else setModelDraft({ model, effort, tier });
  }

  function contents(): ReactNode {
    if (field === 'provider') return providers?.providers.map(provider =>
      option(provider.agent_id, provider.label, provider.selected, () => { close(true); void quick.selectProvider(provider.agent_id); },
        !provider.available ? provider.disabled_reason || t('quick.unavailable')
          : !config.supports('select_provider') ? t('config.unsupported') : ''));
    const candidates = related ? account ? config.optionsFor(account) : catalog : undefined;
    if (!candidates) return;
    const { current, availability } = candidates.inspection;
    const supported = (key: string) => availability[key] !== false;
    const { options } = candidates;
    if (directory) return <form onSubmit={event => {
      event.preventDefault();
      if (canEdit && directory.value.trim()) apply({ ...(directory.mode && { run_mode: directory.mode }), root: directory.value });
    }}>
      <DirectoryInput label={t('config.root')} value={directory.value} disabled={!canEdit}
        scope={session.view.id} isCurrent={() => quick.available}
        onPick={value => apply({ ...(directory.mode && { run_mode: directory.mode }), root: value })}
        onChange={value => setDirectory(previous => previous && { ...previous, value })} />
      <button type="submit" disabled={!canEdit || !directory.value.trim()}>{t('quick.apply')}</button>
    </form>;
    if (modelDraft) return <form onSubmit={event => {
      event.preventDefault();
      if (canEdit && modelDraft.effort && modelDraft.tier) apply({ ...(account && { account }),
        model: { id: modelDraft.model.id, reasoning_effort: modelDraft.effort }, service_tier: modelDraft.tier });
    }}>
      <p>{modelDraft.model.id}</p>
      <label>{t('config.reasoning')}<select value={modelDraft.effort}
        onChange={event => setModelDraft({ ...modelDraft, effort: event.target.value })}>
        <option value="" disabled>{t('quick.choose')}</option>
        {modelDraft.model.reasoning_efforts.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>{t('quick.tier')}<select value={modelDraft.tier}
        onChange={event => setModelDraft({ ...modelDraft, tier: event.target.value })}>
        <option value="" disabled>{t('quick.choose')}</option>
        {modelDraft.model.service_tiers.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <button type="submit" disabled={!canEdit || !modelDraft.effort || !modelDraft.tier}>{t('quick.apply')}</button>
    </form>;
    if (field === 'account' && !account) return options.accounts.map(candidate => option(candidate.profile_name,
      candidate.profile_name, candidate.profile_name === effective?.account, () => {
        const request = opening.current;
        void quick.change({ account: candidate }).then(result => {
          if (request !== opening.current) return;
          if (result) setAccount(result.account);
          else close(true);
        });
      }, supported('account') ? '' : t('quick.unavailable')));
    if (field === 'model' || (field === 'account' && account)) {
      if (!same(candidates.inspection.model_options_account, account ?? current.account)) return;
      return options.models.map(model => option(model.id, model.id, !account && model.id === effective?.model,
        () => selectModel(model, current, account), supported('model') && model.reasoning_efforts.length && model.service_tiers.length
          ? '' : t('quick.unavailable')));
    }
    if (field === 'reasoning') {
      const inspected = candidates.inspection.effective;
      const model = effective?.model === current.model.id && (inspected.next_model ?? inspected.model) === current.model.id
        ? options.models.find(candidate => candidate.id === current.model.id) : undefined;
      return model?.reasoning_efforts.map(effort => {
        const desired = { model: { id: model.id, reasoning_effort: effort } };
        return option(effort, effort, effort === effective?.reasoning_effort, () => apply(desired, current.account),
          supported('model') && validDesired(desired, current, candidates) ? '' : t('quick.unavailable'));
      });
    }
    if (field === 'mode') return options.run_modes.map(mode => option(mode, runModeLabel(mode), mode === observation?.run_mode, () => {
      if (direct(mode) && mode !== observation?.run_mode) setDirectory({ mode, value: root });
      else apply({ run_mode: mode });
    }, supported('run_mode') ? '' : t('quick.unavailable')));
    if (field === 'location') return options.targets.map(target => option(target.id, target.project || target.id,
      target.owner === observation?.target.owner && target.project === observation.target.project,
      () => apply({ target: target.id }), supported('target') ? '' : t('quick.unavailable')));
  }

  const fastEnabled = canEdit && fastSupported && supported('service_tier') && !!current && !!catalog
    && validDesired({ service_tier: nextTier }, current, catalog);
  const fastLabel = t(!advertised ? 'quick.fastUnavailable' : !fastSupported ? 'quick.fastUnsupported'
    : effective?.service_tier === 'fast' ? 'quick.fastActive' : 'quick.fastInactive');
  const options = field && contents();
  const optionError = field === 'provider' ? config.providersError : config.optionsError;
  const loaded = field === 'provider' ? !!providers : !!(related && (!account || config.optionsFor(account)));
  const loading = field === 'provider' ? config.providersRefreshing : config.optionsRefreshing;
  return <section className="runner-quick-settings" aria-label={t('quick.label')} aria-busy={pending}>
    <div className="quick-scroll">
      <div className="quick-grid">
        {button('provider', providerLabel)}{button('account', effective?.account)}
        {button('model', effective?.model)}{button('reasoning', effective?.reasoning_effort)}
        <button className="quick-fast" type="button" aria-label={fastLabel} aria-pressed={effective?.service_tier === 'fast'}
          data-supported={fastSupported} aria-disabled={!fastEnabled} title={fastLabel}
          onClick={() => { if (fastEnabled) apply({ service_tier: nextTier }); }}>⚡︎</button>
        {button('mode', observation && runModeLabel(observation.run_mode))}{button('location', locationLabel)}
      </div>
    </div>
    {field && <div className="quick-popover" role="dialog" aria-label={label(field)} tabIndex={-1} ref={panel}>
      <div className="quick-heading">{label(field)}{account && field === 'account' ? ' · ' + account.profile_name : ''}</div>
      {options}
      {optionError && <p role="status">{loaded ? t('quick.retainedOptions', { diagnostic: tr(optionError) }) : tr(optionError)}</p>}
      {!optionError && (!options || Array.isArray(options) && options.length === 0) &&
        <p role="status">{loading || !loaded && !account && !!effective?.agent_id ? t('config.inspecting')
          : loaded ? t('quick.noOptions') : t('quick.unavailable')}</p>}
    </div>}
    {!!quick.confirmations.length && <div className="quick-feedback" role="status">
      <span>{t('config.confirmation')}</span>
      {quick.continuationEnabled && <button type="button" onClick={() => void quick.openContinuation()}>
        {quick.continuationCommand === '/clear' ? t('quick.releaseContext') : t('quick.openCommand', { command: quick.continuationCommand })}
      </button>}
      {!quick.continuationEnabled && !quick.interaction && !quick.canRefreshInteraction && !pending && <span>{t('quick.unsupportedInteraction')}</span>}
    </div>}
    {quick.interaction && <InteractionPanel key={quick.interaction.interaction_id} quick={quick} />}
    {quick.canRefreshInteraction && <button type="button" disabled={pending} onClick={() => void quick.refreshInteraction()}>{t('quick.refreshInteraction')}</button>}
    {!!(quick.detail || config.providerOutcomeUnknown && config.error) &&
      <div className="quick-feedback" role="status">{tr(quick.detail || config.error)}</div>}
  </section>;
}

function InteractionPanel({ quick }: { quick: RunnerQuickConfig }) {
  const interaction = quick.interaction!;
  const [text, setText] = useState('');
  const action = interaction.actions.includes('confirm') ? 'confirm' : 'select';
  return <div className="quick-interaction" aria-label={interaction.prompt}>
    <strong>{interaction.prompt}</strong>
    {interaction.context && <p>{interaction.context}</p>}
    {interaction.consequences?.map((item, index) => <div key={index} data-role={item.role}>
      <p>{item.text}</p>{item.details.map((detail, index) => <p key={index}>{detail}</p>)}
    </div>)}
    {interaction.choices.map(choice => <button key={choice.choice_id} type="button" disabled={!choice.enabled || quick.interactionBusy}
      title={choice.disabled_reason || choice.description} onClick={() => void quick.respond({ action, choice_id: choice.choice_id })}>
      {choice.label}{(choice.disabled_reason || choice.description) && <small>{choice.disabled_reason || choice.description}</small>}
    </button>)}
    {interaction.actions.includes('text') && <form onSubmit={event => { event.preventDefault(); if (text.length) void quick.respond({ action: 'text', text }); }}>
      <input aria-label={interaction.prompt} value={text} onChange={event => setText(event.target.value)} required />
      <button type="submit" disabled={!text.length}>{t('quick.respond')}</button>
    </form>}
    {interaction.actions.filter(action => action === 'back' || action === 'cancel').map(action =>
      <button type="button" key={action} onClick={() => void quick.respond({ action })}>{t(action === 'back' ? 'quick.back' : 'quick.cancelledAction')}</button>)}
  </div>;
}
