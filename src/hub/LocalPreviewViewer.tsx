import { FocusedViewer } from './FocusedViewer';
import { ImageViewport } from './ImageViewport';
import { TextPreview } from './TextPreview';
import { t } from './i18n';
import type { LocalPreview } from './localPreviews';
import { previewFormat } from './previewCatalog';

export function LocalPreviewViewer({ name, content, onDismiss }: {
  name?: string; content: LocalPreview; onDismiss: () => void;
}) {
  const text = content.kind === 'text';
  return <FocusedViewer name={name} showTitle={!text} onDismiss={onDismiss}
    dismissOnBackdrop={content.kind === 'image'} className={text ? 'focused-text-dialog' : undefined}>
    {content.kind === 'image' && <ImageViewport key={content.url} url={content.url}
      name={name || t('images.verifiedEnlarged')} />}
    {content.kind === 'text' && <TextPreview name={name ?? ''} text={content.text}
      syntax={name && previewFormat(name)?.syntax} onDismiss={onDismiss} />}
    {content.kind === 'loading' && <p role="status">{t('preview.loading')}</p>}
    {content.kind === 'unavailable' && <p role="status">{t('preview.unavailable')} {t('preview.escape')}</p>}
  </FocusedViewer>;
}
