import { useHubTranslation, t, tr, msg } from './i18n';
import type { SingleEntry, EntryDefaults } from './singleEntry';

const fields = [
  { key: 'target', label: msg('fields.target'), value: (o: SingleEntry['observed'][number]['observation']) => o.target },
  { key: 'model', label: msg('fields.model'), value: (o: SingleEntry['observed'][number]['observation']) => ({
    model: o.selection.model, reasoning_effort: o.selection.reasoning_effort, service_tier: o.selection.service_tier }) },
  { key: 'account', label: msg('fields.account'), value: (o: SingleEntry['observed'][number]['observation']) => o.selection.account },
  { key: 'runMode', label: msg('fields.runMode'), value: (o: SingleEntry['observed'][number]['observation']) => o.run_mode },
] as const;
const label = (key: keyof EntryDefaults, value: unknown) => {
  if (typeof value === 'string') return value || t('common.notSelected');
  const item = value as Record<string, string>;
  return key === 'target' ? `${item.owner || item.binding_state}${item.project ? ` / ${item.project}` : ''}`
    : `${item.model} · ${item.reasoning_effort} · ${item.service_tier}`;
};

export function SingleEntrySettings({ entry }: { entry: SingleEntry }) {
  useHubTranslation();
  return <section className="context-settings" aria-label={t('entry.defaultsLabel')}>
    <div className="settings-grid">{fields.map(field => {
      const current = entry.defaults[field.key];
      const values = new Map<string, unknown>();
      if (current !== undefined) values.set(JSON.stringify(current), current);
      entry.observed.forEach(({ observation }) => {
        const value = field.value(observation);
        values.set(JSON.stringify(value), value);
      });
      return <label className="setting" key={field.key}><span>{tr(field.label)}</span>
        <select aria-label={t('entry.field', { field: field.label })} disabled={!entry.editable}
          value={current === undefined ? '' : JSON.stringify(current)} onChange={event =>
            entry.setDefault(field.key, event.target.value ? JSON.parse(event.target.value) : undefined)}>
          <option value="">{t('entry.useRunner')}</option>
          {[...values].map(([value, item]) => <option key={value} value={value}>{label(field.key, item)}</option>)}
        </select>
      </label>;
    })}</div>
    <p className="scope-note">{t('entry.defaultsHelp')}</p>
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
          onClick={() => void entry.submit(location)}>{entry.pending ? t('entry.assigning') : t('entry.assign')}</button>
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
