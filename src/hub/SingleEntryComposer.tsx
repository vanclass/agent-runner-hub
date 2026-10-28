import { useHubTranslation, t, tr } from './i18n';
import type { SingleEntry, EntryDefaults } from './singleEntry';
import { DirectoryInput } from './DirectoryInput';

function SingleEntryChoices({ entry }: { entry: SingleEntry }) {
  const defaults = entry.defaults, options = entry.catalog?.options;
  const blocked = !entry.editable || entry.loadingOptions || !options;
  const select = <K extends keyof EntryDefaults>(key: K, title: string, values: { value: EntryDefaults[K]; label: string }[]) => {
    const current = defaults[key], selected = current === undefined ? '' : JSON.stringify(current);
    return <label className="setting"><span>{title}</span><select aria-label={t('entry.field', { field: title })}
      disabled={blocked} value={selected} onChange={e => entry.setDefault(key, e.target.value ? JSON.parse(e.target.value) : undefined)}>
      <option value="">{t('entry.useRunner')}</option>
      {selected && !values.some(v => JSON.stringify(v.value) === selected) &&
        <option value={selected} disabled>{JSON.stringify(current)} · {t('config.unlisted')}</option>}
      {values.map(v => <option key={JSON.stringify(v.value)} value={JSON.stringify(v.value)}>{v.label}</option>)}
    </select></label>;
  };
  const model = options?.models.find(m => m.id === defaults.model?.model);
  return <div className="settings-grid">
    <fieldset><legend>{t('panel.execution')}</legend>
    {select('target', t('fields.target'), options?.targets.map(v => ({
      value: { binding_state: 'bound', owner: v.owner, project: v.project }, label: v.id })) ?? [])}
    {select('runMode', t('fields.runMode'), options?.run_modes.map(value => ({ value, label: value })) ?? [])}
    <DirectoryInput label={t('entry.field', { field: t('config.root') })} scope={defaults}
      isCurrent={() => entry.defaults === defaults && entry.editable && !entry.loadingOptions}
      disabled={blocked || !['pure-direct-run', 'direct-run'].includes(defaults.runMode ?? entry.catalog?.inspection.current.run_mode ?? '')}
      value={defaults.root ?? ''} onChange={value => entry.setDefault('root', value || undefined)} />
    </fieldset>
    <fieldset><legend>{t('panel.model')}</legend>
    {select('accountIdentity', t('fields.account'), options?.accounts.map(v => ({ value: v, label: `${v.agent_id} / ${v.profile_name}` })) ?? [])}
    {select('model', t('fields.model'), options?.models.map(v => ({ label: v.id, value: { model: v.id,
      reasoning_effort: defaults.model?.reasoning_effort ?? v.reasoning_efforts[0],
      service_tier: defaults.model?.service_tier ?? 'default' } })) ?? [])}
    <label className="setting"><span>{t('config.reasoning')}</span><select aria-label={t('entry.field', { field: t('config.reasoning') })}
      disabled={blocked || !model} value={defaults.model?.reasoning_effort ?? ''} onChange={e =>
        defaults.model && entry.setDefault('model', { ...defaults.model, reasoning_effort: e.target.value })}>
      {!model && <option value="">{t('entry.useRunner')}</option>}
      {defaults.model && !model?.reasoning_efforts.includes(defaults.model.reasoning_effort) &&
        <option value={defaults.model.reasoning_effort} disabled>{defaults.model.reasoning_effort} · {t('config.unlisted')}</option>}
      {model?.reasoning_efforts.map(v => <option key={v}>{v}</option>)}
    </select></label>
    <label className="fast-option"><input type="checkbox" aria-label={t('panel.fast')}
      checked={defaults.model?.service_tier === 'fast'}
      disabled={blocked || !model?.service_tiers.includes('fast') || !model.service_tiers.includes('default')}
      onChange={e => defaults.model && entry.setDefault('model', { ...defaults.model,
        service_tier: e.target.checked ? 'fast' : 'default' })} />{t('panel.fast')}</label>
    {defaults.model && (!model?.service_tiers.includes(defaults.model.service_tier)
      || !['default', 'fast'].includes(defaults.model.service_tier)) &&
      <p role="status">{t('panel.retained', { value: defaults.model.service_tier })}</p>}
    </fieldset>
  </div>;
}

export function SingleEntrySettings({ entry }: { entry: SingleEntry }) {
  useHubTranslation();
  return <section className="context-settings" aria-label={t('entry.defaultsLabel')}>
    <label><input type="checkbox" checked={entry.allocationPolicy === 'reuse-idle'} disabled={!entry.editable}
      onChange={e => entry.setDefault('allocationPolicy', e.target.checked ? 'reuse-idle' : 'always-new')} />{t('work.reuseIdle')}</label>
    <p className="scope-note">{t('work.allocationHelp')}</p>
    <button type="button" disabled={!entry.editable || entry.loadingOptions} onClick={() => void entry.inspectOptions()}>
      {entry.loadingOptions ? t('config.inspecting') : t('work.loadOptions')}</button>
    <SingleEntryChoices entry={entry} />
    <p className="scope-note">{t('entry.defaultsHelp')}</p>
    {entry.defaults.account && !entry.defaults.accountIdentity && <p role="status">{t('work.legacyAccount', { account: entry.defaults.account })}</p>}
    {entry.restoredDefaults && <p className="scope-note">{t('entry.restored')}</p>}
  </section>;
}

export function SingleEntryComposer({ entry, location, onSelectRunner }: {
  entry: SingleEntry; location?: string; onSelectRunner: (id: string) => void;
}) {
  return <section className="composer-area" aria-label={t('composer.label')}>
    <div className="composer">
      <textarea aria-label={t('entry.instructions')} rows={3} value={entry.draft} disabled={!entry.editable}
        placeholder={t('entry.placeholder')} onChange={event => entry.setDraft(event.target.value)} />
      <div className="composer-actions"><span className="composer-note">{t('entry.assignmentHint')}</span>
        <button className="send-button" type="button" disabled={!entry.editable || !entry.draft.trim()}
          onClick={() => void entry.submit(location, onSelectRunner)}>{entry.pending ? t('entry.assigning') : t('entry.assign')}</button>
      </div>
    </div>
    {entry.detail && <p role="status" className="control-status">{tr(entry.detail)}</p>}
    {entry.runnerId && <button type="button" onClick={() => onSelectRunner(entry.runnerId!)}>{t('entry.openAssigned')}</button>}
    {entry.phase === 'incomplete' && <div className="composer-actions">
      <button type="button" onClick={() => entry.releaseUnsent()}>{t('entry.release')}</button>
      {entry.runnerId && <button type="button" onClick={() => entry.releaseUnsent(true)}>{t('entry.move')}</button>}
    </div>}
    {entry.phase === 'unknown' && <p role="alert">{t('entry.unknown')}</p>}
    {entry.evidence.length > 0 && <details><summary>{t('entry.evidence')}</summary>
      <ul>{entry.evidence.map((line, index) => <li key={index}>{tr(line)}</li>)}</ul></details>}
  </section>;
}
