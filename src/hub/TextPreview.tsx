import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from './i18n';
import { syntaxSpans, type SyntaxSpan } from './textPreviewSyntax';
import './textPreview.css';

type Line = { start: number; end: number; spans: readonly SyntaxSpan[] };
const NO_SPANS: readonly SyntaxSpan[] = [];

function documentLines(text: string, syntax?: string): Line[] {
  const spans = syntaxSpans(text, syntax);
  let start = 0, index = 0;
  return text.split(/\r\n|\r|\n/).map(line => {
    const end = start + line.length;
    let lineSpans: SyntaxSpan[] | undefined;
    while (index < spans.length && spans[index].from < end) {
      const span = spans[index];
      if (span.to > start) (lineSpans ??= []).push(span);
      if (span.to > end) break;
      index++;
    }
    const row = { start, end, spans: lineSpans ?? NO_SPANS };
    start = end + (text.startsWith('\r\n', end) ? 2 : 1);
    return row;
  });
}

function renderRange(text: string, spans: readonly SyntaxSpan[], from: number, to: number): ReactNode {
  if (!spans.length) return text.slice(from, to);
  const parts: ReactNode[] = [];
  let cursor = from;
  for (const span of spans) {
    const start = Math.max(from, span.from), end = Math.min(to, span.to);
    if (start >= end) continue;
    if (cursor < start) parts.push(text.slice(cursor, start));
    parts.push(<span key={start} className={'preview-token-' + span.kind}>{text.slice(start, end)}</span>);
    cursor = end;
  }
  if (cursor < to) parts.push(text.slice(cursor, to));
  return parts;
}

function findMatches(text: string, query: string) {
  if (!query) return [];
  const literal = query.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return Array.from(text.matchAll(new RegExp(literal, 'giu')), match => match.index);
}

function lineAt(lines: Line[], offset: number) {
  let low = 0, high = lines.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].start <= offset) low = mid;
    else high = mid;
  }
  return low;
}

function renderLine(lines: Line[], text: string, index: number, content: ReactNode) {
  const end = lines[index].end;
  return <span className="preview-line" key={index}>
    <span className="preview-line-source">{content}{text.slice(end, lines[index + 1]?.start ?? end)}</span>
  </span>;
}

export function TextPreview({ name, text, syntax, onDismiss }: {
  name: string; text: string; syntax?: string; onDismiss: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed'>();
  const matchElement = useRef<HTMLElement>(null);
  const lines = useMemo(() => documentLines(text, syntax), [text, syntax]);
  const matches = useMemo(() => findMatches(text, query), [text, query]);
  const match = matches[active];
  const activeLine = match === undefined ? -1 : lineAt(lines, match);
  const rows = useMemo(() => lines.map(({ start, end, spans }, index) =>
    renderLine(lines, text, index, renderRange(text, spans, start, end))), [lines, text]);
  let visibleRows = rows;
  if (activeLine >= 0) {
    const { start, end, spans } = lines[activeLine];
    const matchEnd = match + query.length;
    visibleRows = rows.slice();
    visibleRows[activeLine] = renderLine(lines, text, activeLine, <>
      {renderRange(text, spans, start, match)}
      <mark ref={matchElement}>{renderRange(text, spans, match, matchEnd)}</mark>
      {renderRange(text, spans, matchEnd, end)}
    </>);
  }
  useEffect(() => {
    matchElement.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [match, query, wrap]);

  const step = (delta: number) => {
    if (matches.length) setActive(index => (index + delta + matches.length) % matches.length);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('copyFailed');
    }
  };

  return <>
    <header className="preview-text-toolbar">
      <strong title={name}>{name}</strong>
      <div className="preview-text-controls">
        <div className="preview-text-search" role="search">
          <input role="searchbox" aria-label={t('preview.find')} placeholder={t('preview.find')} value={query}
            onChange={event => { setQuery(event.currentTarget.value); setActive(0); }}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
            }} />
          <span className="preview-match-count" role="status">{query && (matches.length
            ? t('preview.match', { current: active + 1, total: matches.length }) : t('preview.noMatches'))}</span>
          <button type="button" aria-label={t('preview.previousMatch')} title={t('preview.previousMatch')}
            disabled={matches.length < 2} onClick={() => step(-1)}>↑</button>
          <button type="button" aria-label={t('preview.nextMatch')} title={t('preview.nextMatch')}
            disabled={matches.length < 2} onClick={() => step(1)}>↓</button>
        </div>
        <button type="button" aria-pressed={wrap} onClick={() => setWrap(value => !value)}>{t('preview.wrap')}</button>
        <button type="button" onClick={() => void copy()}>{t('preview.copy')}</button>
        <button type="button" aria-label={t('menu.close')} title={t('menu.close')} onClick={onDismiss}>×</button>
      </div>
    </header>
    {copyState && <span className="preview-copy-status" role="status">{copyState === 'copied'
      ? t('preview.copied') : t('preview.copyFailed')}</span>}
    <pre className="focused-text" data-wrap={wrap} tabIndex={0} aria-label={t('preview.originalText')}>{visibleRows}</pre>
  </>;
}
