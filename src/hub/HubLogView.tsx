import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HubLog, formatHubRecord, formatHubTimestamp } from './HubLog';
import { useHubTranslation } from './i18n';
import './hubLog.css';

export function HubLogView({ log }: { log: HubLog }) {
  const { t } = useHubTranslation();
  useSyncExternalStore(log.subscribe, log.getSnapshot);
  const records = log.history;
  const [first, setFirst] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const anchor = useRef<{ sequence: string; offset: number } | null>(null);
  const restoredTop = useRef<number | null>(null);
  const expanding = useRef(false);
  const visible = first === null ? records.slice(-200) : records.filter(record => record.sequence >= first);
  useLayoutEffect(() => {
    if (first === null && visible.length) setFirst(visible[0].sequence);
    const node = viewport.current;
    if (!node) return;
    const previousTop = node.scrollTop;
    if (following.current) node.scrollTop = node.scrollHeight;
    else if (anchor.current) {
      const row = node.querySelector<HTMLElement>(`[data-sequence="${anchor.current.sequence}"]`);
      if (row) node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.current.offset;
    }
    if (node.scrollTop !== previousTop) restoredTop.current = node.scrollTop;
    expanding.current = false;
  });
  return <section className="runner-terminal hub-log" aria-label={t('hubLog.label')}>
    {log.loading && <p role="status">{t('hubLog.loading')}</p>}
    {log.issue && <p role="alert">{t('hubLog.storageFailed', { code: log.issue })}</p>}
    <div className="hub-log-records" tabIndex={0} ref={viewport} onScroll={() => {
      const node = viewport.current!;
      if (restoredTop.current !== null) {
        const restored = Math.abs(node.scrollTop - restoredTop.current) < 0.5;
        restoredTop.current = null;
        if (restored) return;
      }
      following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 2;
      const row = [...node.querySelectorAll<HTMLElement>('[data-sequence]')]
        .find(item => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top);
      anchor.current = row ? { sequence: row.dataset.sequence!, offset: row.getBoundingClientRect().top - node.getBoundingClientRect().top } : null;
      if (node.scrollTop <= 0 && !following.current && !expanding.current) {
        const index = records.findIndex(record => record.sequence === visible[0]?.sequence);
        if (index > 0) {
          expanding.current = true;
          setFirst(records[Math.max(0, index - 200)].sequence);
        }
      }
    }}>
      {visible.map(record => {
        const presentation = formatHubRecord(record);
        return <div className="hub-log-row" key={record.sequence} data-sequence={record.sequence}>
          <time className="hub-log-time">{formatHubTimestamp(record.timestamp)}</time>
          <span className="hub-log-category">{presentation.category}</span>
          <span className={`hub-log-message ${presentation.tone}`}>{presentation.message}</span>
        </div>;
      })}
      {!log.loading && !records.length && <p>{t('hubLog.empty')}</p>}
    </div>
  </section>;
}
