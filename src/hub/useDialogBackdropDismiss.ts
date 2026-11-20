import { useEffect, useRef, type RefObject } from 'react';

// Dialog owners retain dismissal and focus; this hook owns only backdrop admission.
export function useDialogBackdropDismiss(
  dialog: RefObject<HTMLDialogElement>, onDismiss: () => void, enabled = true,
) {
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !enabled) return;
    let pointer: number | undefined;
    const outside = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      return event.target === element && (event.clientX < bounds.left || event.clientX >= bounds.right
        || event.clientY < bounds.top || event.clientY >= bounds.bottom);
    };
    const reset = () => { pointer = undefined; };
    const down = (event: PointerEvent) => {
      pointer = element.open && event.isPrimary && event.button === 0 && outside(event)
        ? event.pointerId : undefined;
    };
    const up = (event: PointerEvent) => {
      const admitted = element.open && event.isPrimary && event.button === 0
        && pointer === event.pointerId && outside(event);
      reset();
      if (admitted) dismiss.current();
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', reset);
    element.addEventListener('lostpointercapture', reset);
    element.addEventListener('close', reset);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', reset);
      element.removeEventListener('lostpointercapture', reset);
      element.removeEventListener('close', reset);
    };
  }, [dialog, enabled]);
}
