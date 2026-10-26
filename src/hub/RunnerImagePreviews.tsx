import { useEffect, useRef, useState } from 'react';
import type { RunnerImages } from './runnerImages';
import './runnerImages.css';

export function RunnerImagePreviews({ images }: { images: RunnerImages }) {
  const [enlarged, setEnlarged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = images.preview;
  useEffect(() => images.mount(), [images]);
  useEffect(() => {
    if (enlarged && preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [enlarged, preview]);
  useEffect(() => { if (!preview) setEnlarged(false); }, [preview]);
  return <section className="generated-images" aria-label="Generated images" data-state={images.state}>
    <div className="generated-images-toolbar">
      <strong>Generated images</strong>
      <span role="status" className="generated-image-status">{images.state === 'loading' ? 'Loading: ' : ''}{images.detail}</span>
      {!!images.items.length && <select aria-label="Select generated image" value={images.selectedId}
        onChange={event => images.select(event.target.value)}>
        {images.items.map((image, index) => <option key={image.imageId} value={image.imageId}>Image {index + 1} · {image.width} × {image.height}</option>)}
      </select>}
      <button type="button" disabled={images.state === 'loading' || images.state === 'unsupported'}
        onClick={() => void images.refresh(true)}>Refresh images</button>
    </div>
    {preview && <button className="generated-image-preview" type="button" aria-label="Enlarge generated image"
      onClick={() => setEnlarged(true)}><img src={preview.url} alt="Verified generated image"
        onError={() => { images.rejectRendering(); }} /><span>{preview.image.width} × {preview.image.height} · Enlarge</span></button>}
    <dialog ref={dialog} className="generated-image-dialog" aria-label="Enlarged generated image"
      onClose={() => setEnlarged(false)} onCancel={() => setEnlarged(false)}>
      <div><strong>Generated image</strong><button type="button" onClick={() => setEnlarged(false)}>Close preview</button></div>
      {preview && <img src={preview.url} alt="Enlarged verified generated image" />}
    </dialog>
  </section>;
}