import { useHubTranslation, t } from './i18n';
type Theme = 'light' | 'black';
export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  useHubTranslation();
  return <div className="theme-picker" role="group" aria-label={t('preferences.theme')}>
    {(['light', 'black'] as const).map(value => <button key={value} type="button"
      aria-pressed={theme === value} onClick={() => onChange(value)}>
      <span className={`theme-dot ${value}`} aria-hidden="true" />{value === 'light' ? t('preferences.light') : t('preferences.black')}
    </button>)}
  </div>;
}
