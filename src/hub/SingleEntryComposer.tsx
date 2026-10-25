import type { SingleEntry, EntryDefaults } from './singleEntry';

const fields = [
  { key: 'target', label: 'Project / Target', value: (o: SingleEntry['observed'][number]['observation']) => o.target },
  { key: 'model', label: 'Model', value: (o: SingleEntry['observed'][number]['observation']) => ({
    model: o.selection.model, reasoning_effort: o.selection.reasoning_effort, service_tier: o.selection.service_tier }) },
  { key: 'account', label: 'Account', value: (o: SingleEntry['observed'][number]['observation']) => o.selection.account },
  { key: 'runMode', label: 'Run Mode', value: (o: SingleEntry['observed'][number]['observation']) => o.run_mode },
] as const;
const label = (key: keyof EntryDefaults, value: unknown) => {
  if (typeof value === 'string') return value || 'Not selected';
  const item = value as Record<string, string>;
  return key === 'target' ? `${item.owner || item.binding_state}${item.project ? ` / ${item.project}` : ''}`
    : `${item.model} · ${item.reasoning_effort} · ${item.service_tier}`;
};

export function SingleEntrySettings({ entry }: { entry: SingleEntry }) {
  return <section className="context-settings" aria-label="Single Entry defaults">
    <div className="settings-grid">{fields.map(field => {
      const current = entry.defaults[field.key];
      const values = new Map<string, unknown>();
      if (current !== undefined) values.set(JSON.stringify(current), current);
      entry.observed.forEach(({ observation }) => {
        const value = field.value(observation);
        values.set(JSON.stringify(value), value);
      });
      return <label className="setting" key={field.key}><span>{field.label}</span>
        <select aria-label={`Single Entry ${field.label}`} disabled={!entry.editable}
          value={current === undefined ? '' : JSON.stringify(current)} onChange={event =>
            entry.setDefault(field.key, event.target.value ? JSON.parse(event.target.value) : undefined)}>
          <option value="">Use Runner's verified setting</option>
          {[...values].map(([value, item]) => <option key={value} value={value}>{label(field.key, item)}</option>)}
        </select>
      </label>;
    })}</div>
    <p className="scope-note">Defaults apply only to this assignment. Choices are observed Runner values; menus remain in each Runner terminal. Existing settings change only through their Runner.</p>
  </section>;
}

export function SingleEntryComposer({ entry, location, onSelectRunner }: {
  entry: SingleEntry; location?: string; onSelectRunner: (id: string) => void;
}) {
  return <section className="composer-area" aria-label="Instruction composer">
    <div className="composer">
      <textarea aria-label="Single Entry instructions" rows={3} value={entry.draft} disabled={!entry.editable}
        placeholder="Assign an instruction to an eligible Runner…" onChange={event => entry.setDraft(event.target.value)} />
      <div className="composer-actions"><span className="composer-note">First eligible Runner, or a new one. Attachments unavailable.</span>
        <button className="send-button" type="button" disabled={!entry.editable || !entry.draft.trim()}
          onClick={() => void entry.submit(location)}>{entry.pending ? 'Assigning…' : 'Assign instruction'}</button>
      </div>
    </div>
    {entry.detail && <p role="status" className="control-status">{entry.detail}</p>}
    {entry.runnerId && <button type="button" onClick={() => onSelectRunner(entry.runnerId!)}>Open assigned Runner</button>}
    {entry.phase === 'incomplete' && <div className="composer-actions">
      <button type="button" onClick={() => entry.releaseUnsent()}>Release unsent assignment</button>
      {entry.runnerId && <button type="button" onClick={() => entry.releaseUnsent(true)}>Move unsent instruction to Runner</button>}
    </div>}
    {entry.phase === 'unknown' && <p role="alert">Instruction retained for inspection. Delivery may have occurred; automatic retry and reassignment are blocked.</p>}
    {entry.evidence.length > 0 && <details><summary>Assignment evidence</summary>
      <ul>{entry.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
  </section>;
}
