import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { resolveRunnerInstallation, savedRunnerLocation, saveRunnerLocation, type RunnerInstallation } from './runnerInstallation';
import { DirectoryInput } from './DirectoryInput';

export type { RunnerInstallation } from './runnerInstallation';

export function RunnerLocation({ installation, onChange, preparation }: {
  installation: RunnerInstallation | null; onChange: (installation: RunnerInstallation | null) => void;
  preparation?: HubText;
}) {
  useHubTranslation();
  const [location, setLocation] = useState(() => installation?.root ?? savedRunnerLocation());
  const generation = useRef(0);
  const locationRef = useRef(location);
  locationRef.current = location;
  useEffect(() => () => { ++generation.current; }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<HubText>('');
  async function verify() {
    const request = ++generation.current;
    setPending(true); setError(''); onChange(null);
    try {
      const result = await resolveRunnerInstallation(location);
      if (generation.current !== request) return;
      onChange(result);
      saveRunnerLocation(result.root);
    } catch (reason) { if (generation.current === request) setError(errorText(reason)); }
    finally { if (generation.current === request) setPending(false); }
  }
  return <section className="runner-location" aria-label={t('location.installation')}>
    <DirectoryInput label={t('location.label')} value={location} disabled={pending}
      isCurrent={() => locationRef.current === location && !pending}
      placeholder={t('location.placeholder')} onChange={value => { ++generation.current; setLocation(value); onChange(null); setError(''); }} />
    <button type="button" disabled={pending || !location.trim()} onClick={() => void verify()}>{t('location.verify')}</button>
    <p>{t('location.help')}</p>
    {pending && <p role="status">{t('location.verifying')}</p>}
    {installation && <p role="status">{t('location.verified')}</p>}
    {preparation && <p role="status">{tr(preparation)}</p>}
    {error && <p role="alert">{tr(error)}</p>}
  </section>;
}
