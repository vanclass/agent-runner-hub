import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

export function MenuPanel({ label, focusItem, children }: {
  label: string; focusItem?: string; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
    (items.find(item => item.dataset.menuItem === focusItem) ?? items[0])?.focus();
  }, [label, focusItem]);
  return <div ref={panel} className="application-menu-panel" id="application-menu-panel" role="menu" aria-label={label}>
    {children}
  </div>;
}

export function MenuItem({ id, label, value, title, icon, submenu, dialog, checked, radio, disabled, onSelect }: {
  id: string; label: string; value?: string; title?: string; icon?: string; submenu?: boolean;
  dialog?: boolean; checked?: boolean; radio?: boolean; disabled?: boolean; onSelect: () => void;
}) {
  const mark = checked ? '✓' : icon;
  const valueId = useId();
  return <button type="button" className="application-menu-item" tabIndex={-1} data-menu-item={id}
    role={radio ? 'menuitemradio' : checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
    aria-label={label} aria-describedby={value ? valueId : undefined} aria-checked={checked}
    aria-disabled={disabled} aria-haspopup={submenu ? 'menu' : dialog ? 'dialog' : undefined}
    title={title} onClick={() => { if (!disabled) onSelect(); }}>
    <span className="menu-mark" aria-hidden="true">{mark}</span>
    <span>{label}</span>
    {value && <span id={valueId} className="menu-value">{value}</span>}
    {submenu && <span className="menu-arrow" aria-hidden="true">›</span>}
  </button>;
}
