import type { KeyboardEvent } from 'react';

export function instructionKey(event: KeyboardEvent<HTMLTextAreaElement>, submit: (briefRun: boolean) => void,
  moveHistory: (action: 'undo' | 'redo') => void) {
  if (event.altKey || event.metaKey || event.nativeEvent.isComposing
    || event.nativeEvent.keyCode === 229 || event.currentTarget !== document.activeElement
    || event.currentTarget.disabled || document.querySelector('dialog[open]')) return;
  if (event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && (key === 'z' || key === 'y')) {
    if (!event.currentTarget.readOnly) {
      event.preventDefault();
      moveHistory(key === 'z' ? 'undo' : 'redo');
    }
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!event.repeat) submit(event.ctrlKey);
}
