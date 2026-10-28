import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { resolveRunnerInstallation, savedRunnerLocation, saveRunnerLocation, type RunnerInstallation } from './runnerInstallation';
import { DirectoryInput } from './DirectoryInput';

export type { RunnerInstallation } from './runnerInstallation';

export function RunnerLocation({ installation, onChange, required = false }: {
  installation: RunnerInstallation | null; onChange: (installation: RunnerInstallation) => void;
  required?: boolean;
}) {
  useHubTranslation();
  const [location, setLocation] = useState(() => installation?.root ?? savedRunnerLocation());
  const generation = useRef(0);
  const locationRef = useRef(location);
  locationRef.current = location;
  useEffect(() => {
    if (required && location.trim()) void verify();
    return () => { ++generation.current; };
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<HubText>('');
  async function verify() {
    const request = ++generation.current;
    setPending(true); setError('');
    try {
      const result = await resolveRunnerInstallation(location);
      if (generation.current !== request) return;
      saveRunnerLocation(result.root);
      setLocation(result.root);
      onChange(result);
    } catch (reason) { if (generation.current === request) setError(errorText(reason)); }
    finally { if (generation.current === request) setPending(false); }
  }
  return <form className="runner-location" aria-label={t('location.installation')} aria-busy={pending}
    onSubmit={event => { event.preventDefault(); if (!pending && location.trim()) void verify(); }}>
    <DirectoryInput label={t('location.label')} value={location} disabled={pending}
      isCurrent={() => locationRef.current === location && !pending}
      placeholder={t('location.placeholder')} onChange={value => { ++generation.current; setLocation(value); setError(''); }} />
    <p className="installation-help">{t('location.help')}</p>
    {pending && <p role="status">{t('location.verifying')}</p>}
    {installation?.root === location && !pending && <p className="installation-success" role="status">{t('location.verified')}</p>}
    {error && <p role="alert">{tr(error)}</p>}
    <button className="installation-verify" type="submit" disabled={pending || !location.trim()}>
      {t(pending ? 'location.verifying' : required ? 'setup.start' : 'location.verify')}
    </button>
  </form>;
}
