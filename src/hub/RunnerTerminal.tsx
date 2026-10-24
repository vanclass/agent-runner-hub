import { useEffect, useRef, useState } from 'react';
import type { RunnerSession } from './RunnerSessions';

export function RunnerTerminal({ session, theme }: { session: RunnerSession; theme: 'light' | 'black' }) {
  const host = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (host.current) return session.attach(host.current, theme);
  }, [session]);
  useEffect(() => session.setTheme(theme), [session, theme]);
  return <section className="runner-terminal" aria-label="Runner terminal">
    <div className="terminal-tools">
      <label>Search <input aria-label="Search terminal" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" onClick={() => session.search.findPrevious(query)}>Previous</button>
      <button type="button" onClick={() => session.search.findNext(query)}>Next</button>
    </div>
    <div className="terminal-host" ref={host} />
  </section>;
}
