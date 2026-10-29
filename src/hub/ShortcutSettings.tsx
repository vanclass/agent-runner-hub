import { useEffect, useRef, useState } from 'react';
import { captureShortcut, defaultShortcuts, projectShortcuts, shortcutLabel, type ShortcutMap } from './shortcuts';
import { useHubTranslation, type HubText } from './i18n';

export function ShortcutSettings({ value, onSave, onClose }: {
  value: ShortcutMap; onSave: (value: ShortcutMap) => HubText; onClose: () => void;
}) {
  const { t, tr } = useHubTranslation();
  const [draft, setDraft] = useState(value);
  const [capturing, setCapturing] = useState<keyof ShortcutMap>();
  const [issue, setIssue] = useState<HubText>('');
  const dialog = useRef<HTMLDialogElement>(null);
  const valid = projectShortcuts(draft);
  const labels = { assign: t('shortcuts.assign'), entry: t('shortcuts.entry'), runner: t('shortcuts.runner') };
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="app-settings shortcut-settings" aria-labelledby="shortcuts-title"
    aria-describedby="shortcuts-help" onCancel={event => {
      event.preventDefault();
      if (capturing) setCapturing(undefined); else onClose();
    }} onKeyDown={event => {
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (!capturing || event.key === 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      const chord = captureShortcut(event.nativeEvent, capturing === 'runner');
      if (!chord) { setIssue(t('shortcuts.invalid')); return; }
      setDraft(current => ({ ...current, [capturing]: chord }));
      setCapturing(undefined); setIssue('');
    }}>
    <button type="button" className="settings-close" aria-label={t('setup.close')} onClick={onClose}>×</button>
    <h1 id="shortcuts-title">{t('shortcuts.title')}</h1>
    <p id="shortcuts-help">{t('shortcuts.help')}</p>
    {(['assign', 'entry', 'runner'] as const).map(action => <div className="shortcut-row" key={action}>
      <span>{labels[action]}</span>
      <button type="button" aria-label={labels[action]} aria-pressed={capturing === action}
        onClick={() => { setCapturing(action); setIssue(''); }}>
        {capturing === action ? t('shortcuts.capture') : shortcutLabel(draft[action])}
      </button>
    </div>)}
    {!valid && <p role="alert">{t('shortcuts.conflict')}</p>}
    {issue && <p role="alert">{tr(issue)}</p>}
    <div className="composer-actions">
      <button type="button" onClick={() => { setDraft({ ...defaultShortcuts }); setCapturing(undefined); setIssue(''); }}>
        {t('shortcuts.reset')}</button>
      <button type="button" disabled={!valid || !!capturing} onClick={() => {
        const failure = onSave(valid!);
        if (failure) setIssue(failure); else onClose();
      }}>{t('shortcuts.save')}</button>
    </div>
  </dialog>;
}
