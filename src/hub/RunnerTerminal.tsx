import { useHubTranslation, t } from './i18n';
import { useEffect, useRef } from 'react';
import type { RunnerSession } from './RunnerSessions';

export function RunnerTerminal({ session, theme }: { session: RunnerSession; theme: 'light' | 'black' }) {
  useHubTranslation();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) return session.attach(host.current, theme);
  }, [session]);
  useEffect(() => session.setTheme(theme), [session, theme]);
  return <section className="runner-terminal" aria-label={t('terminal.label')}>
    <div className="terminal-host" ref={host} />
  </section>;
}
