import { useEffect, useRef } from 'react';
import { t, useHubTranslation } from './i18n';

export function RunnerTabRemoval({ name, onRemove, onCancel }: {
  name: string; onRemove: () => void; onCancel: () => void;
}) {
  useHubTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <>
    <dialog ref={dialog} className="tab-close-dialog" aria-labelledby="tab-close-title"
      aria-describedby="tab-close-consequence" onCancel={onCancel}>
      <h2 id="tab-close-title">{t('tabs.confirmTitle', { name })}</h2>
      <p id="tab-close-consequence">{t('tabs.consequence')}</p>
      <div className="tab-close-actions">
        <button type="button" autoFocus onClick={onCancel}>{t('tabs.cancel')}</button>
        <button type="button" onClick={() => {
          onRemove();
        }}>{t('tabs.confirmClose')}</button>
      </div>
    </dialog>
  </>;
}
