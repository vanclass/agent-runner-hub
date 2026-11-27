import { useEffect, useRef, type ReactNode } from 'react';
import { t } from './i18n';
import { useDialogBackdropDismiss } from './useDialogBackdropDismiss';

export function HubDialog({ className, title, description, required = false, children, onClose }: {
  className: string; title: string; description?: string; required?: boolean; children: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useDialogBackdropDismiss(dialog, onClose, !required);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>(required ? 'input' : '.settings-close')?.focus();
    return () => { element.close(); };
  }, [required]);

  return <dialog ref={dialog} className={`hub-dialog ${className}`} aria-labelledby="hub-dialog-title"
    aria-describedby={description ? 'hub-dialog-description' : undefined}
    onCancel={event => { event.preventDefault(); if (!required) onClose(); }}
    onKeyDown={event => {
      if (required && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    {required && <div className="installation-brand"><span className="brand-mark" aria-hidden="true">A</span><strong>AgentRunnerHub</strong></div>}
    {!required && <button type="button" className="settings-close" aria-label={t('menu.close')} onClick={onClose}>×</button>}
    <h1 id="hub-dialog-title">{title}</h1>
    {description && <p id="hub-dialog-description">{description}</p>}
    {children}
  </dialog>;
}
