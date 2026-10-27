import { useHubTranslation, i18n } from './i18n';
import type { HubLanguage } from './preferences';

export function LanguagePicker({ onChange }: { onChange: (language: HubLanguage) => void }) {
  const { t } = useHubTranslation();
  return <label className="language-picker"><span>{t('preferences.language')}</span>
    <select aria-label={t('preferences.language')} value={i18n.resolvedLanguage ?? 'en'}
      onChange={event => onChange(event.target.value as HubLanguage)}>
      <option value="en" lang="en">English</option>
      <option value="ko" lang="ko">한국어</option>
    </select>
  </label>;
}
