import { useLayoutEffect, useRef, useState } from 'react';
import { validRetentionDays } from './HubLog';
import { useHubTranslation } from './i18n';

export function RetentionPopover({ value, onApply, onCancel }: {
  value: number; onApply: (value: number) => void; onCancel: () => void;
}) {
  const { t } = useHubTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  useLayoutEffect(() => { input.current?.select(); input.current?.focus(); }, []);
  return <form className="application-menu-panel retention-popover" id="application-menu-panel"
    role="dialog" aria-labelledby="retention-label" noValidate
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = event.currentTarget.querySelectorAll('button');
      if (event.shiftKey && document.activeElement === input.current) {
        event.preventDefault(); buttons[buttons.length - 1]?.focus();
      } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
        event.preventDefault(); input.current?.focus();
      }
      event.stopPropagation();
    }}
    onSubmit={event => {
      event.preventDefault();
      const days = input.current?.valueAsNumber;
      if (typeof days === 'number' && validRetentionDays(days)) onApply(days);
      else { setInvalid(true); input.current?.focus(); }
    }}>
    <label id="retention-label" htmlFor="retention-days">{t('hubLog.retention')}</label>
    <input id="retention-days" type="number" min="1" max="4294967295" step="1" ref={input}
      defaultValue={value} onChange={() => setInvalid(false)} aria-invalid={invalid}
      aria-describedby={invalid ? 'retention-error' : undefined} required />
    {invalid && <p id="retention-error" className="runner-error" role="alert">{t('menu.invalidRetention')}</p>}
    <div className="retention-actions">
      <button type="button" onClick={onCancel}>{t('menu.cancel')}</button>
      <button type="submit">{t('menu.apply')}</button>
    </div>
  </form>;
}
