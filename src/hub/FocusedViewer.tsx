import { useEffect, useRef, type ReactNode } from 'react';
import { t } from './i18n';
import { useDialogBackdropDismiss } from './useDialogBackdropDismiss';
import './focusedViewer.css';

export function FocusedViewer({ name, children, onDismiss, dismissOnBackdrop = false, className, showTitle = true }: {
  name?: string; children: ReactNode; onDismiss: () => void; showTitle?: boolean;
  dismissOnBackdrop?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement>();
  useDialogBackdropDismiss(dialog, onDismiss, dismissOnBackdrop);
  useEffect(() => {
    if (!returnFocus.current && document.activeElement instanceof HTMLElement)
      returnFocus.current = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      queueMicrotask(() => {
        if (!element?.isConnected && returnFocus.current?.isConnected)
          returnFocus.current.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={dialog} className={className ? 'focused-viewer ' + className : 'focused-viewer'}
    aria-label={name || t('preview.focus')} onCancel={event => { event.preventDefault(); onDismiss(); }} onClose={onDismiss}>
    {name && showTitle && <header><strong>{name}</strong></header>}
    {children}
  </dialog>;
}
