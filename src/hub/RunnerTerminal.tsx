import { useHubTranslation, t } from './i18n';
import { useEffect, useRef } from 'react';
import type { RunnerSession } from './RunnerSessions';
import { RunnerPresentationView } from './RunnerPresentationView';

export function RunnerTerminal({ session, theme }: { session: RunnerSession; theme: 'light' | 'black' }) {
  useHubTranslation();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) return session.attach(host.current, theme);
  }, [session]);
  useEffect(() => session.setTheme(theme), [session, theme]);
  const presentation = session.control.presentation.state;
  return <section className="runner-terminal" aria-label={t('terminal.label')}>
    {presentation.mode === 'unsupported' && <div className="presentation-limitation" role="status">{t('presentation.unsupported')}</div>}
    <div className={`terminal-host${presentation.mode === 'unsupported' ? '' : ' terminal-protocol-only'}`}
      aria-hidden={presentation.mode !== 'unsupported'} ref={host} />
    {presentation.mode !== 'unsupported' && <RunnerPresentationView key={session.view.id} state={presentation} />}
  </section>;
}
