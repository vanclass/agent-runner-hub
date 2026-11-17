import { useEffect, useRef, useState, type ReactNode } from 'react';
import { watchFileDrop } from './composerFileDrop';
import type { RunnerReferenceSelection, Candidate } from './referenceSelection';
import { t, tr } from './i18n';
import { FocusedViewer } from './FocusedViewer';
import { attachmentName, previewKind } from './localPreviews';

function referenceState(state: Candidate['phase']) {
  switch (state) {
    case 'capturing': return t('references.state.capturing');
    case 'staged': return t('references.state.staged');
    case 'registering': return t('references.state.registering');
    case 'removing': return t('references.state.removing');
    case 'removed': return t('references.state.removed');
    case 'cancelled': return t('references.state.cancelled');
    case 'queued': return t('references.state.queued');
    case 'pending-interaction': return t('references.state.interaction');
    case 'registered': return t('references.state.registered');
    case 'rejected': return t('references.state.rejected');
    case 'failed': return t('references.state.failed');
    case 'outcome-unknown': return t('references.state.unknown');
  }
}

export function ComposerAttachments({ selection, disabled, children }: {
  selection: RunnerReferenceSelection; disabled: boolean; children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [dropUnavailable, setDropUnavailable] = useState(false);
  const [focusedKey, setFocusedKey] = useState<number>();
  const available = !disabled && selection.available;
  useEffect(() => {
    let disposed = false, stop: (() => void) | undefined;
    const inside = (position?: { x: number; y: number }) => {
      const rect = host.current?.getBoundingClientRect();
      const x = (position?.x ?? -1) / window.devicePixelRatio, y = (position?.y ?? -1) / window.devicePixelRatio;
      return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    void Promise.resolve().then(() => watchFileDrop((paths, position) => {
      if (!disposed && available && inside(position)) selection.select(paths);
      if (!disposed) setHover(false);
    }, position => { if (!disposed) setHover(available && inside(position)); }))
      .then(unlisten => { if (disposed) unlisten(); else stop = unlisten; })
      .catch(() => { if (!disposed) setDropUnavailable(true); });
    return () => { disposed = true; stop?.(); };
  }, [selection, available]);
  const items = selection.candidates.filter(item => !item.submitted && selection.state(item) !== 'cancelled'
    && (selection.state(item) !== 'removed' || !item.cancelRequested));
  const focused = items.find(item => item.key === focusedKey);
  useEffect(() => { if (!focused) setFocusedKey(undefined); }, [focused]);
  const focusedThumbnail = focused && selection.thumbnail(focused);
  const content = focusedThumbnail ? { kind: 'image' as const, url: focusedThumbnail }
    : focused && selection.previews.get(focused.key) || { kind: 'unavailable' as const, reason: 'unsupported' };
  return <div ref={host} className={`composer attachment-composer${hover ? ' attachment-drop-active' : ''}`}
    onDragOver={event => { event.preventDefault(); if (available) setHover(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHover(false); }}
    onDrop={event => { event.preventDefault(); setHover(false); }}
    onPaste={event => {
      const image = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))?.getAsFile();
      if (!image) return;
      event.preventDefault();
      if (available) void selection.captureImage(image);
    }}>
    {hover && <div className="attachment-drop-hint" role="status">{t('attachments.drop')}</div>}
    {!!items.length && <ul className="pending-attachments" aria-label={t('attachments.pending')}>
      {items.map(item => { const state = selection.state(item), thumbnail = selection.thumbnail(item);
        const name = item.image ? t('references.clipboardNumber', { index: item.key }) : attachmentName(item.path);
        return <li className="attachment-chip" key={item.key}>
        <button type="button" className="attachment-open" title={item.path}
          aria-label={t('preview.open', { name: attachmentName(item.path) || t('references.clipboardNumber', { index: item.key }) })}
          onClick={() => {
            if (!item.image && previewKind(item.path) !== 'unsupported') selection.previews.load(item.key, item.path);
            setFocusedKey(item.key);
          }}>
          {thumbnail && <img src={thumbnail} alt={item.image ? t('references.clipboardPreview', { index: item.key }) : name} />}
          <span>{name}</span>
        </button>
        {(state !== 'staged' || item.detail) && <span role="status">{referenceState(state)} {item.detail && tr(item.detail)}</span>}
        <button type="button" className="attachment-remove" disabled={!available || !!item.cancelRequested} aria-label={t('attachments.remove', { name: item.path || item.key })}
          onClick={() => void selection.cancel(item.key)}>×</button>
        {['registered', 'removed', 'failed', 'rejected'].includes(selection.state(item)) && <button type="button" disabled={!available}
          onClick={() => void selection.reconcile(item.key)}>{t('attachments.reconcile')}</button>}
        {(item.cancelRequested || state === 'outcome-unknown') && <button type="button" disabled={!available}
          onClick={() => void selection.refresh()}>{t('references.reconcile')}</button>}
      </li>; })}
    </ul>}
    {selection.otherPending.length > 0 && <div role="alert">{t('references.otherHelp')}
      <ul>{selection.otherPending.map(item => <li key={item.reference_id}>{item.display_name}</li>)}</ul>
      <button type="button" disabled={!available} onClick={() => selection.reviewOtherPending()}>{t('references.includeOthers')}</button>
    </div>}
    {selection.error && <p role="alert">{tr(selection.error)}</p>}
    {children}
    {focused && <FocusedViewer key={focused.key} name={attachmentName(focused.path) || undefined}
      content={content} onDismiss={() => setFocusedKey(undefined)} />}
    {dropUnavailable && <p role="alert">{t('attachments.fallback')}</p>}
  </div>;
}
