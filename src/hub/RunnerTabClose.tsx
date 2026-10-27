import { useEffect, useRef, useState } from 'react';
import { t, useHubTranslation } from './i18n';

export function RunnerTabClose({ name, closing, onClose }: {
  name: string; closing: boolean; onClose: () => Promise<void>;
}) {
  useHubTranslation();
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);
  return <div className="tab-close">
    <button type="button" className="terminate-runner" disabled={closing}
      onClick={() => setConfirming(true)}>{t('tabs.close')}</button>
    {closing && <span role="status">{t('tabs.closing')}</span>}
    <dialog ref={dialog} className="tab-close-dialog" aria-labelledby="tab-close-title"
      aria-describedby="tab-close-consequence" onCancel={() => setConfirming(false)}>
      <h2 id="tab-close-title">{t('tabs.confirmTitle', { name })}</h2>
      <p id="tab-close-consequence">{t('tabs.consequence')}</p>
      <div className="tab-close-actions">
        <button type="button" autoFocus onClick={() => setConfirming(false)}>{t('tabs.cancel')}</button>
        <button type="button" onClick={() => {
          setConfirming(false);
          void onClose();
        }}>{t('tabs.confirmClose')}</button>
      </div>
    </dialog>
  </div>;
}
