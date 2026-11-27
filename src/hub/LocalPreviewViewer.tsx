import { lazy, Suspense } from 'react';
import { FocusedViewer } from './FocusedViewer';
import { ImageViewport } from './ImageViewport';
import { TextPreview } from './TextPreview';
import { t } from './i18n';
import type { LocalPreview } from './localPreviews';
import { previewFormat } from './previewCatalog';

const PdfPreview = lazy(() => import('./PdfPreview')
  .then(({ PdfPreview }) => ({ default: PdfPreview }))
  .catch(() => ({ default: () => <PreviewStatus unavailable /> })));

export function LocalPreviewViewer({ name, content, onDismiss }: {
  name?: string; content: LocalPreview; onDismiss: () => void;
}) {
  const text = content.kind === 'text';
  const pdf = content.kind === 'pdf';
  return <FocusedViewer name={name} showTitle={!text && !pdf} onDismiss={onDismiss}
    dismissOnBackdrop={content.kind === 'image'}
    className={pdf ? 'focused-pdf-dialog' : text ? 'focused-text-dialog' : undefined}>
    {content.kind === 'image' && <ImageViewport key={content.url} url={content.url}
      name={name || t('images.verifiedEnlarged')} />}
    {content.kind === 'text' && <TextPreview name={name ?? ''} text={content.text}
      syntax={name && previewFormat(name)?.syntax} onDismiss={onDismiss} />}
    {content.kind === 'pdf' && <Suspense fallback={<PreviewStatus />}>
      <PdfPreview name={name ?? ''} bytes={content.bytes} onDismiss={onDismiss}
        loading={<PreviewStatus />} unavailable={<PreviewStatus unavailable />} />
    </Suspense>}
    {content.kind === 'loading' && <PreviewStatus />}
    {content.kind === 'unavailable' && <PreviewStatus unavailable />}
  </FocusedViewer>;
}

function PreviewStatus({ unavailable = false }: { unavailable?: boolean }) {
  return <p role="status">{unavailable ? `${t('preview.unavailable')} ${t('preview.escape')}` : t('preview.loading')}</p>;
}
