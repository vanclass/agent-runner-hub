import { useHubTranslation, t, tr } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { RunnerImages } from './runnerImages';
import './runnerImages.css';

export function RunnerImagePreviews({ images }: { images: RunnerImages }) {
  useHubTranslation();
  const [enlarged, setEnlarged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = images.preview;
  useEffect(() => images.mount(), [images]);
  useEffect(() => {
    if (enlarged && preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [enlarged, preview]);
  useEffect(() => { if (!preview) setEnlarged(false); }, [preview]);
  return <details className="generated-images" aria-label={t('images.label')} data-state={images.state}>
    <summary>{t('images.label')}</summary>
    <div className="generated-images-toolbar">
      <strong>{t('images.label')}</strong>
      <span role="status" className="generated-image-status">{images.state === 'loading' ? t('images.loading') : ''}{tr(images.detail)}</span>
      {!!images.items.length && <select aria-label={t('images.select')} value={images.selectedId}
        onChange={event => images.select(event.target.value)}>
        {images.items.map((image, index) => <option key={image.imageId} value={image.imageId}>{t('images.number', { index: index + 1 })} · {image.width} × {image.height}</option>)}
      </select>}
      <button type="button" disabled={images.state === 'loading' || images.state === 'unsupported'}
        onClick={() => void images.refresh(true)}>{t('images.refresh')}</button>
    </div>
    {preview && <button className="generated-image-preview" type="button" aria-label={t('images.enlarge')}
      onClick={() => setEnlarged(true)}><img src={preview.url} alt={t('images.verified')}
        onError={() => { images.rejectRendering(); }} /><span>{preview.image.width} × {preview.image.height} · {t('images.enlargeAction')}</span></button>}
    <dialog ref={dialog} className="generated-image-dialog" aria-label={t('images.dialog')}
      onClose={() => setEnlarged(false)} onCancel={() => setEnlarged(false)}>
      <div><strong>{t('images.image')}</strong><button type="button" onClick={() => setEnlarged(false)}>{t('images.close')}</button></div>
      {preview && <img src={preview.url} alt={t('images.verifiedEnlarged')} />}
    </dialog>
  </details>;
}
