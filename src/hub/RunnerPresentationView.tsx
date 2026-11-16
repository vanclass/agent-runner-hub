import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { t } from './i18n';
import type { PresentationState, PresentationSpan } from './RunnerPresentation';
import './runnerPresentation.css';

// Runner semantic class identities, with theme-owned colors rather than PTY ANSI.
function spanStyle(style: string): CSSProperties {
  const result: CSSProperties = {};
  for (const token of style.split(/\s+/)) {
    if (token === 'bold') result.fontWeight = 700;
    if (token === 'italic') result.fontStyle = 'italic';
    if (token === 'underline') result.textDecoration = 'underline';
    if (token === 'strike') result.textDecoration = 'line-through';
    if (/^(fg:)?#[\da-f]{6}$/i.test(token)) result.color = token.replace(/^fg:/, '');
    if (/^bg:#[\da-f]{6}$/i.test(token)) result.backgroundColor = token.slice(3);
  }
  return result;
}
function Styled({ spans }: { spans: PresentationSpan[] }) {
  return <>{spans.map((span, index) => <span key={index} style={spanStyle(span.style)}
    className={span.style.split(/\s+/).filter(s => /^class:[\w-]+$/.test(s)).map(s => s.slice(6)).join(' ')}>{span.text}</span>)}</>;
}
export function RunnerPresentationView({ state }: { state: PresentationState }) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = state.follow ? element.scrollHeight : state.scrollTop;
    return () => { state.scrollTop = element.scrollTop; };
  });
  return <div className="runner-semantic" ref={viewport} aria-label={t('presentation.label')}
    onScroll={event => {
      const element = event.currentTarget;
      state.scrollTop = element.scrollTop;
      state.follow = element.scrollHeight - element.scrollTop - element.clientHeight < 4;
    }}>
    {state.mode === 'connecting' && <p role="status">{t('presentation.connecting')}</p>}
    {state.incomplete && <div className="presentation-warning" role="status">
      <strong>{t('presentation.incomplete')}</strong>
      {[...state.issues].map(issue => <div key={issue}>{issue}</div>)}
    </div>}
    <div className="semantic-logs">{state.records.map((record, index) =>
      <span className="semantic-record" key={`${index}-${record.id}`}><Styled spans={record.spans} /></span>)}</div>
    {!!state.activities.size && <div className="semantic-activities" aria-label={t('presentation.activity')}>
      {[...state.activities].map(([id, activity]) => <div className="semantic-activity" key={id}>
        <Styled spans={activity.spans ?? []} /></div>)}
    </div>}
    {state.mode === 'closed' && <p className="presentation-ended">{t('presentation.closed')}</p>}
  </div>;
}
