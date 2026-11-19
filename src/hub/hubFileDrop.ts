import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { watchFileDrop } from './composerFileDrop';
import type { RunnerReferenceSelection } from './referenceSelection';
import type { RunnerSession } from './RunnerSessions';
import type { SingleEntry } from './singleEntry';

export function runnerAttachmentsDisabled(session: RunnerSession) {
  return !!session.view.closing || !!session.view.submitting || session.control.commandPending
    || session.assignmentReserved || session.submissionUncertain;
}
export function entryAttachmentsDisabled(entry: SingleEntry) {
  return entry.pending || entry.phase === 'unknown';
}

type Destination = { key: string; selection: RunnerReferenceSelection; disabled: () => boolean };

export function useHubFileDrop(host: RefObject<HTMLDivElement>, destination: Destination | undefined) {
  const current = useRef(destination);
  useLayoutEffect(() => { current.current = destination; });
  const [hovered, setHovered] = useState<Destination>();
  const [unavailable, setUnavailable] = useState(false);
  const enabled = !!destination && !destination.disabled() && destination.selection.available;
  useEffect(() => { setHovered(undefined); }, [destination?.key, destination?.selection, enabled]);
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes'
        || Array.from(record.addedNodes).some(node => node instanceof Element
          && (node.matches('[role="dialog"], dialog') || node.querySelector('[role="dialog"], dialog'))))) {
        setHovered(undefined);
      }
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setHovered(undefined); };
    window.addEventListener('keydown', cancel);
    return () => { observer.disconnect(); window.removeEventListener('keydown', cancel); };
  }, [host]);
  useEffect(() => {
    let disposed = false, stop: (() => void) | undefined;
    const targetAt = (position?: { x: number; y: number }) => {
      const target = current.current, rect = host.current?.getBoundingClientRect();
      if (!target || target.disabled() || !target.selection.available || !rect || !position
        || host.current?.querySelector('[role="dialog"], dialog[open]')) return;
      const x = position.x / window.devicePixelRatio, y = position.y / window.devicePixelRatio;
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return target;
    };
    void Promise.resolve().then(() => watchFileDrop((paths, position) => {
      if (disposed) return;
      const target = targetAt(position);
      setHovered(undefined);
      if (target) target.selection.select(paths);
    }, position => { if (!disposed) setHovered(targetAt(position)); }))
      .then(unlisten => { if (disposed) unlisten(); else stop = unlisten; })
      .catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; stop?.(); };
  }, [host]);
  return { active: enabled && hovered?.key === destination?.key
    && hovered?.selection === destination?.selection, unavailable };
}
