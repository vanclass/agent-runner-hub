import { useEffect, useRef } from 'react';
import { t } from './i18n';
import { previewExtensions } from './localPreviews';
import './focusedViewer.css';

export function PreviewHelp() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => () => dialog.current?.close(), []);
  return <>
    <button type="button" className="app-settings-trigger" aria-haspopup="dialog"
      onClick={() => dialog.current?.showModal()}>{t('preview.help')}</button>
    <dialog ref={dialog} className="focused-viewer preview-help" aria-label={t('preview.help')}>
      <h2>{t('preview.help')}</h2>
      <dl>
        <dt>{t('preview.images')}</dt><dd>{previewExtensions.image.map(ext => `.${ext}`).join(', ')}</dd>
        <dt>{t('preview.text')}</dt><dd>{previewExtensions.text.map(ext => `.${ext}`).join(', ')}</dd>
        <dt>{t('preview.other')}</dt><dd>{t('preview.otherLimits')}</dd>
      </dl>
      <p>{t('preview.limits')}</p>
      <button type="button" onClick={() => dialog.current?.close()}>{t('preview.close')}</button>
    </dialog>
  </>;
}
