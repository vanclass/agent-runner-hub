import { useEffect, useId, useRef, useState } from 'react';
import { selectFolder } from '../../.runner/web-app-desktop/io/nativeIO';
import { isTauri } from '@tauri-apps/api/core';
import { errorText, HubError, msg, t, tr, type HubText } from './i18n';

/** A picker edits one directory draft; verification and apply stay with its owner. */
export function DirectoryInput({ label, value, onChange, disabled = false, placeholder, scope, isCurrent }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
  placeholder?: string; scope?: unknown; isCurrent: () => boolean;
}) {
  const id = useId();
  const alive = useRef(true), picking = useRef(false), generation = useRef(0);
  const latest = useRef({ value, scope, disabled });
  latest.current = { value, scope, disabled };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<HubText>('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; }; }, []);
  useEffect(() => { ++generation.current; setError(''); }, [value, scope, disabled]);
  async function browse() {
    if (disabled || picking.current || !isCurrent()) return;
    const request = ++generation.current;
    const initial = latest.current;
    const valid = () => alive.current && generation.current === request && isCurrent()
      && latest.current.value === initial.value && latest.current.scope === initial.scope && !latest.current.disabled;
    picking.current = true; setPending(true); setError('');
    try {
      if (!isTauri()) throw new HubError(msg('location.nativeRequired'));
      const folder = await selectFolder();
      if (valid() && typeof folder === 'string') onChange(folder);
    } catch (reason) { if (valid()) setError(errorText(reason)); }
    finally { picking.current = false; if (alive.current) setPending(false); }
  }
  return <div className="directory-field setting">
    <label htmlFor={id}>{label}</label>
    <div className="directory-input">
      <input id={id} aria-label={label} value={value} disabled={disabled} placeholder={placeholder}
        onChange={event => { ++generation.current; setError(''); onChange(event.target.value); }} />
      <button type="button" disabled={disabled || pending} aria-label={t('directory.browseFor', { field: label })}
        aria-busy={pending} onClick={() => void browse()}>{t(pending ? 'directory.picking' : 'directory.browse')}</button>
    </div>
    {error && <p role="alert" className="runner-error">{t('directory.failed', { reason: tr(error) })}</p>}
  </div>;
}
