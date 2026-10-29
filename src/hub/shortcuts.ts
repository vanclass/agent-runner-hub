import { useEffect, useRef } from 'react';

export type ShortcutMap = { assign: string; entry: string; runner: string };
export const defaultShortcuts: ShortcutMap = { assign: 'Ctrl+Enter', entry: 'Home', runner: 'Ctrl+Digit' };
const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const specialKeys = /^(Enter|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F([1-9]|1[0-9]|2[0-4]))$/;
function parts(value: string) {
  const tokens = value.split('+'), key = tokens.pop()!;
  if (tokens.some((token, index) => !modifiers.includes(token) || tokens.indexOf(token) !== index)
    || tokens.join('+') !== modifiers.filter(token => tokens.includes(token)).join('+')) return;
  if (!specialKeys.test(key) && !/^[A-Z0-9]$/.test(key) && key !== 'Digit') return;
  if ((key === 'Digit' || /^[A-Z0-9]$/.test(key)) && !tokens.some(token => token !== 'Shift')) return;
  if (tokens.join('+') === 'Ctrl' && /^[ACVXYZ]$/.test(key)) return;
  return { key, prefix: tokens.join('+') };
}
export function projectShortcuts(value: unknown): ShortcutMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !['assign', 'entry', 'runner'].every(key => typeof record[key] === 'string')) return;
  const result = { assign: record.assign as string, entry: record.entry as string, runner: record.runner as string };
  const assign = parts(result.assign), entry = parts(result.entry), runner = parts(result.runner);
  if (!assign || !entry || !runner || assign.key === 'Digit' || entry.key === 'Digit' || runner.key !== 'Digit') return;
  if (result.assign === result.entry || [assign, entry].some(chord => chord.prefix === runner.prefix && /^[1-9]$/.test(chord.key))) return;
  return result;
}
function prefix(event: KeyboardEvent) {
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean).join('+');
}
export function captureShortcut(event: KeyboardEvent, ordinal = false): string | undefined {
  if (event.isComposing || ['Process', 'Dead', 'Unidentified'].includes(event.key) || event.getModifierState('AltGraph')) return;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (ordinal && !/^[1-9]$/.test(key)) return;
  const value = [prefix(event), ordinal ? 'Digit' : key].filter(Boolean).join('+');
  return parts(value) ? value : undefined;
}
export function shortcutAction(event: KeyboardEvent, shortcuts: ShortcutMap): keyof ShortcutMap | undefined {
  const chord = captureShortcut(event);
  if (chord === shortcuts.assign) return 'assign';
  if (chord === shortcuts.entry) return 'entry';
  if (/^[1-9]$/.test(event.key) && captureShortcut(event, true) === shortcuts.runner) return 'runner';
}
export function shortcutLabel(value: string) { return value.replace('Digit', '1, 2, 3…'); }

type ShortcutActions = { assign: () => void; select: (id: string | null) => void };
export function useHubShortcuts(shortcuts: ShortcutMap, runnerIds: readonly string[], canAssign: boolean, actions: ShortcutActions) {
  const current = useRef({ shortcuts, runnerIds, canAssign, actions });
  current.current = { shortcuts, runnerIds, canAssign, actions };
  useEffect(() => {
    const held = new Set<string>();
    let composing = false;
    const stop = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const key = (event: KeyboardEvent) => {
      const identity = event.code || event.key;
      if (held.has(identity)) {
        stop(event);
        if (event.type === 'keyup') held.delete(identity);
        return;
      }
      if (event.type !== 'keydown' || composing || event.isComposing || document.querySelector('dialog[open]')) return;
      const state = current.current, action = shortcutAction(event, state.shortcuts);
      if (!action) return;
      const target = action === 'runner' ? state.runnerIds[Number(event.key) - 1] : undefined;
      if (action === 'assign' && !state.canAssign || action === 'runner' && !target) return;
      stop(event); held.add(identity);
      if (event.repeat) return;
      if (action === 'assign') state.actions.assign();
      else state.actions.select(action === 'entry' ? null : target!);
    };
    const start = () => { composing = true; };
    const end = () => { composing = false; };
    const blur = () => { held.clear(); composing = false; };
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    window.addEventListener('keypress', key, true);
    window.addEventListener('compositionstart', start, true);
    window.addEventListener('compositionend', end, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('keypress', key, true);
      window.removeEventListener('compositionstart', start, true);
      window.removeEventListener('compositionend', end, true);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
