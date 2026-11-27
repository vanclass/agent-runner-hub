import { t } from './i18n';
import { previewExtensions } from './localPreviews';
import { HubDialog } from './HubDialog';

export function PreviewHelp({ onClose }: { onClose: () => void }) {
  return <HubDialog className="preview-help" title={t('preview.help')} description={t('preview.eligibility')} onClose={onClose}>
    <div className="preview-guide-formats">
      <PreviewFormats label={t('preview.images')} extensions={previewExtensions.image} />
      <PreviewFormats label={t('preview.text')} extensions={previewExtensions.text} />
    </div>
    <section><h2>{t('preview.other')}</h2><p>{t('preview.otherLimits')}</p></section>
    <section><h2>{t('preview.limitations')}</h2><p>{t('preview.limits')}</p></section>
  </HubDialog>;
}

function PreviewFormats({ label, extensions }: { label: string; extensions: readonly string[] }) {
  return <section><h2>{label}</h2>
    <ul className="preview-format-tags">
      {extensions.map(extension => <li key={extension}>.{extension}</li>)}
    </ul>
  </section>;
}
