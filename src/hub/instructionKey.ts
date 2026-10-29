import type { KeyboardEvent } from 'react';

/** Only instruction textareas own submission keys; editing remains browser-owned. */
export function instructionKey(event: KeyboardEvent<HTMLTextAreaElement>, submit: (briefRun: boolean) => void) {
  if (event.key !== 'Enter' || event.altKey || event.metaKey || event.nativeEvent.isComposing
    || event.nativeEvent.keyCode === 229 || event.currentTarget !== document.activeElement
    || event.currentTarget.disabled || document.querySelector('dialog[open]')) return;
  if (event.shiftKey) return;
  event.preventDefault();
  if (!event.repeat) submit(event.ctrlKey);
}
