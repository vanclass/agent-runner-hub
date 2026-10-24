type Theme = 'light' | 'black';
export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return <div className="theme-picker" role="group" aria-label="Application theme">
    {(['light', 'black'] as const).map(value => <button key={value} type="button"
      aria-pressed={theme === value} onClick={() => onChange(value)}>
      <span className={`theme-dot ${value}`} aria-hidden="true" />{value === 'light' ? 'Light' : 'Black'}
    </button>)}
  </div>;
}
