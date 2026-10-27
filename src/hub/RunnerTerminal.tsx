import { useHubTranslation, t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { RunnerSession } from './RunnerSessions';

export function RunnerTerminal({ session, theme }: { session: RunnerSession; theme: 'light' | 'black' }) {
  useHubTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (host.current) return session.attach(host.current, theme);
  }, [session]);
  useEffect(() => session.setTheme(theme), [session, theme]);
  return <section className="runner-terminal" aria-label={t('terminal.label')}>
    <div className="terminal-tools">
      <label>{t('terminal.search')}<input aria-label={t('terminal.searchLabel')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" onClick={() => session.search.findPrevious(query)}>{t('terminal.previous')}</button>
      <button type="button" onClick={() => session.search.findNext(query)}>{t('terminal.next')}</button>
    </div>
    <div className="terminal-host" ref={host} />
  </section>;
}
