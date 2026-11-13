import { useState, useSyncExternalStore } from 'react';
import { HubLog, formatHubRecord } from './HubLog';
import { useHubTranslation } from './i18n';
import './hubLog.css';

export function HubLogView({ log }: { log: HubLog }) {
  const { t } = useHubTranslation();
  useSyncExternalStore(log.subscribe, log.getSnapshot);
  const records = log.history;
  const [shown, setShown] = useState(200);
  return <section className="runner-terminal hub-log" aria-label={t('hubLog.label')}>
    <div className="terminal-tools"><span>{t('hubLog.label')}</span>
      {records.length > shown && <button onClick={() => setShown(value => value + 200)}>{t('hubLog.older')}</button>}
    </div>
    {log.loading && <p role="status">{t('hubLog.loading')}</p>}
    {log.issue && <p role="alert">{t('hubLog.storageFailed', { code: log.issue })}</p>}
    <div className="hub-log-records" tabIndex={0}>
      {records.slice(-shown).map(record => <pre key={record.sequence}>{formatHubRecord(record)}</pre>)}
      {!log.loading && !records.length && <p>{t('hubLog.empty')}</p>}
      {log.pending.length > 0 && <div className="hub-log-pending"><p>{t('hubLog.unsaved')}</p>
        {log.pending.map((event, index) => <pre key={index}>{`${event.component}/${event.operation} actual=${event.actual} code=${event.code}`}</pre>)}
      </div>}
    </div>
  </section>;
}
