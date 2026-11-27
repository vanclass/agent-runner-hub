import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { i18n, useHubTranslation, type HubText, type MessageKey } from './i18n';
import { allocationOptions, domainOptions } from './applicationChoices';
import { MenuItem, MenuPanel } from './MenuPanel';
import { InstallationDialog } from './InstallationDialog';
import { PreviewHelp } from './PreviewHelp';
import { ShortcutSettings } from './ShortcutSettings';
import { RetentionPopover } from './RetentionPopover';
import type { RunnerInstallation } from './runnerInstallation';
import type { HubLanguage } from './preferences';
import type { TerminalThemePreference } from './terminalTheme';
import type { ShortcutMap } from './shortcuts';
import './applicationMenu.css';

type Choice<T> = readonly { value: T; label: MessageKey }[];
type Theme = 'light' | 'black';
type Allocation = typeof allocationOptions[number]['value'];
type Display = typeof domainOptions[number]['value'];

export type ApplicationPreferences = {
  installation: RunnerInstallation | null; onVerified: (value: RunnerInstallation) => void;
  allocationPolicy: Allocation; reuseEditable: boolean; onAllocationPolicy: (value: Allocation) => void;
  confirmRemoval: boolean; onConfirmRemoval: (value: boolean) => void;
  theme: Theme; onTheme: (value: Theme) => void;
  terminalTheme: TerminalThemePreference; onTerminalTheme: (value: TerminalThemePreference) => void;
  domainDisplay: Display; onDomainDisplay: (value: Display) => void;
  onLanguage: (value: HubLanguage) => void;
  retentionDays: number; onRetentionDays: (value: number) => void;
  shortcuts: ShortcutMap; onShortcutsSave: (value: ShortcutMap) => HubText;
};

const groupLabels = { runner: 'menu.runner', view: 'menu.view', settings: 'menu.settings', help: 'menu.help' } as const;
type Group = keyof typeof groupLabels;
const groups = Object.keys(groupLabels) as Group[];
type Trigger = Group | 'compact';
type Editor = 'installation' | 'shortcuts' | 'preview';
type Submenu = 'allocation' | 'theme' | 'terminal-theme' | 'domain' | 'language' | 'retention';
type MenuPath = { trigger: Trigger; group?: Group; submenu?: Submenu; focusItem?: string };
const themes: Choice<Theme> = [{ value: 'light', label: 'preferences.light' }, { value: 'black', label: 'preferences.black' }];
const terminalThemes: Choice<TerminalThemePreference> = [
  { value: 'follow', label: 'preferences.followAppTheme' },
  { value: 'light', label: 'preferences.light' },
  { value: 'dark', label: 'preferences.dark' },
];
const languages: Choice<HubLanguage> = [{ value: 'en', label: 'menu.english' }, { value: 'ko', label: 'menu.korean' }];

export function ApplicationMenu({ workspace, ...props }: ApplicationPreferences & { workspace: RefObject<HTMLDivElement> }) {
  const { t } = useHubTranslation();
  const [path, setPath] = useState<MenuPath>();
  const [editor, setEditor] = useState<{ kind: Editor; trigger: Trigger }>();
  const root = useRef<HTMLElement>(null);
  const restore = useRef<Trigger>();
  const group = path?.group;
  const submenu = path?.submenu;
  const menuOpen = !!path;

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!menuOpen || !element) return;
    element.inert = true;
    return () => { element.inert = false; };
  }, [workspace, menuOpen]);

  function triggerButton(trigger: Trigger) {
    return root.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${trigger}"]`);
  }
  function focusTrigger(trigger: Trigger) {
    const button = triggerButton(trigger);
    (button?.offsetWidth ? button : triggerButton(trigger === 'compact' ? 'runner' : 'compact'))?.focus();
  }
  useLayoutEffect(() => {
    if (!path && !editor && restore.current) {
      focusTrigger(restore.current);
      restore.current = undefined;
    }
  }, [path, editor]);

  function close() {
    restore.current = path?.trigger ?? editor?.trigger;
    setPath(undefined);
    setEditor(undefined);
  }
  function open(trigger: Trigger) {
    setPath({ trigger, group: trigger === 'compact' ? undefined : trigger });
  }
  function goBack() {
    if (!path) return;
    if (submenu) setPath({ ...path, submenu: undefined, focusItem: submenu });
    else if (path.trigger === 'compact' && group) setPath({ trigger: 'compact', focusItem: group });
    else close();
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (editor || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const trigger = target.dataset.menuTrigger as Trigger | undefined;
    const items = [...root.current!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
    const item = items.find(button => button === target);
    const key = event.key;
    if (path && key === 'Escape') { event.preventDefault(); event.stopPropagation(); goBack(); return; }
    if (submenu === 'retention') return;
    if (path && key === 'Tab') {
      focusTrigger(path.trigger);
      setPath(undefined);
      return;
    }
    if (trigger && (key === 'ArrowDown' || key === 'ArrowUp')) {
      event.preventDefault();
      open(trigger);
      return;
    }
    if (item && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const index = items.indexOf(item);
      const next = key === 'Home' ? 0 : key === 'End' ? items.length - 1
        : (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    if (key === 'ArrowRight' && item?.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault();
      item.click();
      return;
    }
    if (key === 'ArrowLeft' && path && (submenu || path.trigger === 'compact' && group)) {
      event.preventDefault();
      goBack();
      return;
    }
    const active = trigger ?? path?.trigger;
    if (!active || active === 'compact' || !['ArrowLeft', 'ArrowRight'].includes(key)) return;
    event.preventDefault();
    const next = groups[(groups.indexOf(active) + (key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length];
    if (path) open(next); else focusTrigger(next);
  }

  function editorItem(id: Editor, label: MessageKey, icon: string, value?: string, title?: string) {
    return <MenuItem id={id} label={t(label)} icon={icon} value={value} title={title} dialog
      onSelect={() => {
        setEditor({ kind: id, trigger: path!.trigger });
        setPath(undefined);
      }} />;
  }
  function choiceItem<T extends string>(id: Submenu, label: MessageKey, icon: string, options: Choice<T>, value: T,
    apply: (value: T) => void, disabled = false, title?: string) {
    if (submenu !== id) return <MenuItem id={id} label={t(label)} icon={icon} submenu disabled={disabled} title={title}
      value={t(options.find(option => option.value === value)!.label)}
      onSelect={() => setPath({ ...path!, submenu: id, focusItem: value })} />;
    return <MenuPanel label={t(label)} focusItem={path?.focusItem}>
      <MenuItem id="back" label={t('menu.back')} icon="‹" onSelect={goBack} />
      {options.map(option => <MenuItem key={option.value} id={option.value} label={t(option.label)}
        checked={option.value === value} radio disabled={disabled} onSelect={() => { apply(option.value); goBack(); }} />)}
    </MenuPanel>;
  }

  const language: HubLanguage = i18n.resolvedLanguage === 'ko' ? 'ko' : 'en';
  const location = props.installation?.root;
  const displayPath = location && location.length > 22 ? `…${location.slice(-21)}` : location;
  const entries = {
    runner: () => <>
      {editorItem('installation', 'location.installation', '⌂', displayPath, location)}
      {choiceItem('allocation', 'work.allocationPolicy', '⇄', allocationOptions, props.allocationPolicy,
        props.onAllocationPolicy, !props.reuseEditable, t('work.allocationHelp'))}
      <MenuItem id="removal" label={t('tabs.confirmPreference')} checked={props.confirmRemoval}
        value={t(props.confirmRemoval ? 'menu.on' : 'menu.off')} onSelect={() => props.onConfirmRemoval(!props.confirmRemoval)} />
    </>,
    view: () => <>
      {choiceItem('theme', 'preferences.theme', '◐', themes, props.theme, props.onTheme)}
      {choiceItem('terminal-theme', 'preferences.terminalTheme', '▣', terminalThemes, props.terminalTheme, props.onTerminalTheme)}
      {choiceItem('domain', 'sidebar.domainDisplay', '▤', domainOptions, props.domainDisplay, props.onDomainDisplay)}
    </>,
    settings: () => <>
      {choiceItem('language', 'preferences.language', '文', languages, language, props.onLanguage)}
      <MenuItem id="retention" label={t('hubLog.retention')} icon="◷" dialog
        value={new Intl.NumberFormat(language).format(props.retentionDays)}
        onSelect={() => setPath({ ...path!, submenu: 'retention' })} />
      {editorItem('shortcuts', 'shortcuts.title', '⌨')}
    </>,
    help: () => editorItem('preview', 'preview.help', '?'),
  };

  function renderPanel() {
    if (submenu === 'retention') return <RetentionPopover value={props.retentionDays}
      onApply={value => { props.onRetentionDays(value); goBack(); }} onCancel={goBack} />;
    if (submenu === 'allocation') return choiceItem('allocation', 'work.allocationPolicy', '', allocationOptions,
      props.allocationPolicy, props.onAllocationPolicy, !props.reuseEditable);
    if (submenu === 'theme') return choiceItem('theme', 'preferences.theme', '', themes, props.theme, props.onTheme);
    if (submenu === 'terminal-theme') return choiceItem('terminal-theme', 'preferences.terminalTheme', '', terminalThemes,
      props.terminalTheme, props.onTerminalTheme);
    if (submenu === 'domain') return choiceItem('domain', 'sidebar.domainDisplay', '', domainOptions, props.domainDisplay, props.onDomainDisplay);
    if (submenu === 'language') return choiceItem('language', 'preferences.language', '', languages, language, props.onLanguage);
    return <MenuPanel label={t(group ? groupLabels[group] : 'menu.label')} focusItem={path?.focusItem}>
      {group ? <>
        {path?.trigger === 'compact' && <MenuItem id="back" label={t('menu.back')} icon="‹" onSelect={goBack} />}
        {entries[group]()}
      </> : groups.map(id => <MenuItem key={id} id={id} label={t(groupLabels[id])} submenu
        onSelect={() => setPath({ trigger: 'compact', group: id })} />)}
    </MenuPanel>;
  }
  return <nav className="application-menu" ref={root} aria-label={t('menu.label')} onKeyDown={onKeyDown}>
    {path && <div aria-hidden="true" className="application-menu-shield" onClick={close} />}
    {([...groups, 'compact'] as const).map(id => <button key={id} type="button" className="application-menu-trigger"
      data-menu-trigger={id} aria-haspopup="menu" aria-expanded={path?.trigger === id}
      aria-controls={path?.trigger === id ? 'application-menu-panel' : undefined}
      onClick={() => path?.trigger === id ? close() : open(id)}>
      {id === 'compact' && <span aria-hidden="true">☰ </span>}{t(id === 'compact' ? 'menu.compact' : groupLabels[id])}
    </button>)}
    {path && renderPanel()}
    {editor?.kind === 'installation' && <InstallationDialog installation={props.installation} onVerified={props.onVerified} onClose={close} />}
    {editor?.kind === 'shortcuts' && <ShortcutSettings value={props.shortcuts} onSave={props.onShortcutsSave} onClose={close} />}
    {editor?.kind === 'preview' && <PreviewHelp onClose={close} />}
  </nav>;
}
