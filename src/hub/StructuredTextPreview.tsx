import { useMemo, useState, type ReactNode } from 'react';
import { t } from './i18n';
import { parsePreviewJson, type JsonValue } from './previewJson';

// 한 번에 표시하는 행 수입니다. 늘리면 한 번에 더 많이 표시하고, 줄이면 초기 렌더링 작업이 줄어듭니다.
const ROW_BATCH = 100;

function JsonRows<T>({ rows, renderRow }: { rows: readonly T[]; renderRow: (row: T, index: number) => ReactNode }) {
  const [limit, setLimit] = useState(ROW_BATCH);
  const nextBatch = Math.min(ROW_BATCH, rows.length - limit);
  return <>
    {rows.slice(0, limit).map(renderRow)}
    {nextBatch > 0 && <button type="button" className="preview-json-more"
      onClick={event => {
        if (limit + nextBatch === rows.length) event.currentTarget.parentElement?.focus({ preventScroll: true });
        setLimit(limit + nextBatch);
      }}>{t('preview.moreJsonRows', { total: nextBatch })}</button>}
  </>;
}

function JsonTree({ value, label, initiallyExpanded = false }: {
  value: JsonValue; label?: string; initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const key = label === undefined ? null : <><span className="preview-json-key">{label}</span>{': '}</>;
  if (value.kind !== 'object' && value.kind !== 'array') {
    return <div className="preview-json-row">{key}<span className={'preview-json-' + value.kind}>{value.token}</span></div>;
  }

  const count = value.kind === 'object' ? value.entries.length : value.items.length;
  const brackets = value.kind === 'object' ? '{}' : '[]';
  const summary = <>{key}{brackets} <span className="preview-json-count">({count})</span></>;
  return <div className="preview-json-branch">
    {count > 0 ? <button type="button" className="preview-json-toggle" aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>
      <span className="preview-json-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>{summary}
    </button> : <div className="preview-json-row">{summary}</div>}
    {count > 0 && expanded && <div className="preview-json-children" tabIndex={-1}>
      {value.kind === 'object'
        ? <JsonRows rows={value.entries} renderRow={(entry, index) =>
          <JsonTree key={index} label={entry.key} value={entry.value} />} />
        : <JsonRows rows={value.items} renderRow={(item, index) =>
          <JsonTree key={index} label={String(index)} value={item} />} />}
    </div>}
  </div>;
}

function withoutInitialBom(text: string) {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

export function JsonPreview({ text }: { text: string }) {
  const root = useMemo(() => parsePreviewJson(withoutInitialBom(text)), [text]);
  return <div className="preview-json" tabIndex={0} role="region" aria-label={t('preview.jsonView')}>
    {root ? <JsonTree value={root} initiallyExpanded /> :
      <p className="preview-json-error" role="status">{t('preview.invalidJson')}</p>}
  </div>;
}

function JsonRecord({ line, number }: { line: string; number: number }) {
  const value = useMemo(() => parsePreviewJson(line), [line]);
  return <div className="preview-json-record">
    <span className="preview-json-line">{t('preview.recordLine', { line: number })}</span>
    {value ? <JsonTree value={value} /> :
      <span className="preview-json-error">{t('preview.invalidRecord')}</span>}
  </div>;
}

export function JsonlPreview({ text }: { text: string }) {
  const lines = useMemo(() => {
    const records = withoutInitialBom(text).split(/\r\n|\r|\n/);
    if (records.at(-1) === '') records.pop();
    return records;
  }, [text]);
  return <div className="preview-json" tabIndex={0} role="region" aria-label={t('preview.recordView')}>
    {lines.length ? <JsonRows rows={lines} renderRow={(line, index) =>
      <JsonRecord key={index} number={index + 1} line={line} />} /> :
      <p role="status">{t('preview.noRecords')}</p>}
  </div>;
}
