import { useHubTranslation, t } from './i18n';
import type { SingleEntry, EntryDefaults } from './singleEntry';
import type { HubSelections } from './HubSelections';
import { same } from './runnerConfigContract';
import { DirectoryInput } from './DirectoryInput';
import { ComposerAttachments } from './ComposerAttachments';
import { ComposerPresentation } from './ComposerPresentation';
import { InstructionTextarea } from './InstructionTextarea';
import { runModeLabel } from './runModeLabel';
import { runModes } from './runnerWork';
import { entryAttachmentsDisabled } from './hubFileDrop';

function providerLabel(id: unknown) {
  return id === 'codex' ? 'Codex' : id === 'claude' ? 'Claude'
    : t(id === 'none' ? 'config.providerNone' : 'config.providerUnavailable');
}

export function HubSelectionSettings({ entry, observedAgentId, configuredStartupAgentId }: {
  entry: HubSelections; observedAgentId?: string; configuredStartupAgentId: unknown;
}) {
  const defaults = entry.defaults, catalog = entry.catalog, options = catalog?.options;
  const provider = observedAgentId ?? entry.effectiveAgentId;
  const providerOptions = provider === catalog?.inspection.effective.agent_id ? options : undefined;
  const models = same(defaults.accountIdentity, catalog?.inspection.model_options_account) ? providerOptions?.models : [];
  const compatible = !!provider && defaults.model?.agent_id === provider ? defaults.model : undefined;
  const blocked = !entry.editable || entry.loadingOptions;
  const select = <K extends keyof EntryDefaults>(key: K, title: string, values: { value: EntryDefaults[K]; label: string }[]) => {
    const current = defaults[key], selected = current === undefined ? '' : JSON.stringify(current);
    const retained = key === 'model' ? defaults.model?.model
      : key === 'accountIdentity' ? `${defaults.accountIdentity?.agent_id} / ${defaults.accountIdentity?.profile_name}`
        : key === 'target' ? defaults.target?.project || 'workspace'
          : key === 'runMode' ? runModeLabel(String(current ?? '')) : String(current ?? '');
    return <label className="setting"><span>{title}</span><select aria-label={t('entry.field', { field: title })}
      disabled={blocked} value={selected} onChange={e => entry.setDefault(key, e.target.value ? JSON.parse(e.target.value) : undefined)}>
      <option value="" disabled={key === 'runMode'}>{key === 'accountIdentity' ? t('entry.selectAccount') : key === 'runMode' ? title : t('entry.useRunner')}</option>
      {selected && !values.some(v => JSON.stringify(v.value) === selected) &&
        <option value={selected} title={retained} disabled>{retained}{options && ` · ${t('config.unlisted')}`}</option>}
      {values.map(v => <option key={JSON.stringify(v.value)} value={JSON.stringify(v.value)}>{v.label}</option>)}
    </select></label>;
  };
  const model = models?.find(m => m.id === compatible?.model);
  return <section>
    <div className="settings-grid">
    <section className="settings-group account-settings"><h2>{t('fields.account')}</h2>
      <p className="scope-note">{t('config.effectiveProvider', { provider: providerLabel(provider) })}</p>
      <p className="scope-note">{t('config.startupProvider', { provider: providerLabel(configuredStartupAgentId) })}</p>
      {select('accountIdentity', t('fields.account'), providerOptions?.accounts.map(v => ({ value: v, label: `${v.agent_id} / ${v.profile_name}` })) ?? [])}
    </section>
    <section className="settings-group execution-settings"><h2>{t('panel.execution')}</h2>
    {select('runMode', t('fields.runMode'), options?.run_modes.filter(value => runModes.includes(value as typeof runModes[number]))
      .map(value => ({ value, label: runModeLabel(value) })) ?? [])}
    {!['pure-direct-run', 'direct-run'].includes(defaults.runMode ?? '') &&
      select('target', t('fields.target'), options?.targets.map(v => ({
        value: { binding_state: 'bound', owner: v.owner, project: v.project }, label: v.project || v.id })) ?? [])}
    {['pure-direct-run', 'direct-run'].includes(defaults.runMode ?? '') && <>
    <DirectoryInput label={t('entry.field', { field: t('config.root') })} scope={defaults}
      isCurrent={() => entry.defaults === defaults && entry.editable && !entry.loadingOptions}
      disabled={!entry.editable || !['pure-direct-run', 'direct-run'].includes(defaults.runMode ?? '')}
      value={defaults.root ?? ''} onChange={value => entry.setDefault('root', value || undefined)} />
    <p className="scope-note">{t('config.rootHelp')}</p></>}
    </section>
    <section className="settings-group model-settings"><h2>{t('panel.model')}</h2>
    {select('model', t('fields.model'), models?.map(v => ({ label: v.id, value: { model: v.id,
      reasoning_effort: compatible?.reasoning_effort ?? v.reasoning_efforts[0],
      service_tier: compatible?.service_tier ?? v.service_tiers[0], agent_id: provider } })) ?? [])}
    <label className="setting"><span>{t('config.reasoning')}</span><select aria-label={t('entry.field', { field: t('config.reasoning') })}
      disabled={blocked || !model} value={defaults.model?.reasoning_effort ?? ''} onChange={e =>
        defaults.model && entry.setDefault('model', { ...defaults.model, reasoning_effort: e.target.value })}>
      {!model && <option value="">{t('entry.useRunner')}</option>}
      {defaults.model && !model?.reasoning_efforts.includes(defaults.model.reasoning_effort) &&
        <option value={defaults.model.reasoning_effort} disabled>{defaults.model.reasoning_effort}{options && ` · ${t('config.unlisted')}`}</option>}
      {model?.reasoning_efforts.map(v => <option key={v}>{v}</option>)}
    </select></label>
    <label className="fast-option"><input type="checkbox" aria-label={t('panel.fast')}
      checked={compatible?.service_tier === 'fast'}
      disabled={blocked || !model?.service_tiers.includes('fast') || !model.service_tiers.includes('default')}
      onChange={e => defaults.model && entry.setDefault('model', { ...defaults.model,
        service_tier: e.target.checked ? 'fast' : 'default' })} />{t('panel.fast')}</label>
    {options && defaults.model && (!model?.service_tiers.includes(defaults.model.service_tier)
      || !['default', 'fast'].includes(defaults.model.service_tier)) &&
      <p role="status">{t('panel.retained', { value: defaults.model.service_tier })}</p>}
    </section>
  </div>
  {entry.restoredDefaults && <p className="scope-note">{t('entry.restored')}</p>}
  </section>;
}

export function SingleEntrySettings({ entry }: { entry: SingleEntry }) {
  useHubTranslation();
  return <section className="context-settings" aria-label={t('entry.defaultsLabel')} title={t('entry.defaultsHelp')}>
    <HubSelectionSettings entry={entry.selections} configuredStartupAgentId={entry.selections.configuredStartupAgentId} />
  </section>;
}

export function SingleEntryComposer({ entry, location, onSelectRunner }: {
  entry: SingleEntry; location?: string; onSelectRunner: (id: string) => void;
}) {
  return <ComposerPresentation text={entry.draft} compact={entry.composerCompact}>
    <ComposerAttachments selection={entry.attachments} disabled={entryAttachmentsDisabled(entry)}>
      <InstructionTextarea aria-label={t(entry.defaults.runMode === 'issue-run' ? 'brief.input' : 'entry.instructions')} rows={3} value={entry.draft} disabled={!entry.editable} readOnly={entry.loadingOptions}
        history={entry.instructionHistory} edit={value => entry.setDraft(value)}
        submit={briefRun => {
          if (!briefRun || entry.defaults.runMode === 'issue-run') void entry.submit(location, onSelectRunner, briefRun);
        }}
        placeholder={t('entry.placeholder')} />
    </ComposerAttachments>
  </ComposerPresentation>;
}
