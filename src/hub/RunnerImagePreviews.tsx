import { useHubTranslation, t, tr } from './i18n';
import { useEffect, useState } from 'react';
import { FocusedViewer } from './FocusedViewer';
import type { RunnerImages } from './runnerImages';
import './runnerImages.css';

export function RunnerImagePreviews({ images }: { images: RunnerImages }) {
  useHubTranslation();
  const [enlarged, setEnlarged] = useState(false);
  const preview = images.preview;
  useEffect(() => images.mount(), [images]);
  useEffect(() => { if (!preview) setEnlarged(false); }, [preview]);
  return <section className="generated-images" aria-label={t('images.label')} data-state={images.state}
    data-incomplete={!!images.warning}>
    <div className="generated-images-toolbar">
      <strong>{t('images.label')}</strong>
      <span role="status" className="generated-image-status">{images.state === 'loading' ? t('images.loading') : ''}{tr(images.detail)}</span>
      {!!images.items.length && <select aria-label={t('images.select')} value={images.selectedId}
        onChange={event => images.select(event.target.value)}>
        {images.items.map((image, index) => <option key={image.imageId} value={image.imageId}>{t('images.number', { index: index + 1 })} · {image.width} × {image.height}</option>)}
      </select>}
      <button type="button" disabled={!images.attributionAvailable || images.state === 'loading' || images.state === 'unsupported'}
        onClick={() => void images.refresh(true)}>{t('images.refresh')}</button>
    </div>
    {images.warning && <p role="status" className="generated-image-warning">{tr(images.warning)}</p>}
    {preview && <button className="generated-image-preview" type="button" aria-label={t('images.enlarge')}
      onClick={() => setEnlarged(true)}><img src={preview.url} alt={t('images.verified')}
        onError={() => { images.rejectRendering(); }} /><span>{preview.image.width} × {preview.image.height} · {t('images.enlargeAction')}</span></button>}
    {enlarged && preview && <FocusedViewer key={preview.url} content={{ kind: 'image', url: preview.url }}
      onDismiss={() => setEnlarged(false)} />}
  </section>;
}
