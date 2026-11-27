import { t } from './i18n';
import { previewFormats, type PreviewCategory } from './previewCatalog';
import { HubDialog } from './HubDialog';

export function PreviewHelp({ onClose }: { onClose: () => void }) {
  return <HubDialog className="preview-help" title={t('preview.help')} description={t('preview.eligibility')} onClose={onClose}>
    <div className="preview-guide-formats">
      <PreviewFormats label={t('preview.images')} category="image" />
      <PreviewFormats label={t('preview.text')} category="text" />
      <PreviewFormats label={t('preview.pdf')} category="pdf" />
      <PreviewFormats label={t('preview.archives')} category="archive" />
    </div>
    <section><h2>{t('preview.other')}</h2><p>{t('preview.otherLimits')}</p></section>
    <section><h2>{t('preview.limitations')}</h2>
      <p>{t('preview.limits')}</p><p>{t('preview.textModes')}</p>
      <p>{t('preview.pdfLimits')}</p><p>{t('preview.archiveLimits')}</p>
    </section>
  </HubDialog>;
}

function PreviewFormats({ label, category }: { label: string; category: PreviewCategory }) {
  const labels = previewFormats.filter(format => format.category === category).flatMap(format => [
    ...(format.extensions ?? []).map(extension => '.' + extension),
    ...(format.filenames ?? []),
  ]);
  return <section><h2>{label}</h2>
    <ul className="preview-format-tags">
      {labels.map(name => <li key={name}>{name}</li>)}
    </ul>
  </section>;
}
