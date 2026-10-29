import { useEffect, useRef, useState, type ReactNode } from 'react';
import { watchFileDrop } from '../../.runner/web-app-desktop/io/nativeIO';
import type { RunnerReferenceSelection, Candidate } from './referenceSelection';
import { errorText, t, tr, type HubText } from './i18n';

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
  const [error, setError] = useState<HubText>('');
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
  async function choose(folder: boolean) {
    setError('');
    try { await selection.choose(folder); } catch (reason) { setError(errorText(reason)); }
  }
  const items = selection.candidates.filter(item => !item.submitted && selection.state(item) !== 'cancelled'
    && (selection.state(item) !== 'removed' || !item.cancelRequested));
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
      {items.map(item => { const state = selection.state(item); return <li className="attachment-chip" key={item.key}>
        {item.thumbnail && <img src={item.thumbnail} alt={t('references.clipboardPreview', { index: item.key })} />}
        <span title={item.path}>{item.image ? t('references.clipboardNumber', { index: item.key }) : item.path}</span>
        <span role="status">{referenceState(state)} {item.detail && tr(item.detail)}</span>
        <button type="button" disabled={!available || !!item.cancelRequested} aria-label={t('attachments.remove', { name: item.path || item.key })}
          onClick={() => void selection.cancel(item.key)}>×</button>
        <button type="button" disabled={!available} aria-label={t('attachments.earlier', { name: item.path || item.key })}
          onClick={() => selection.move(item.key, -1)}>←</button>
        <button type="button" disabled={!available} aria-label={t('attachments.later', { name: item.path || item.key })}
          onClick={() => selection.move(item.key, 1)}>→</button>
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
    {error && <p role="alert">{tr(error)}</p>}
    {children}
    <div className="attachments">
      <button type="button" disabled={!available} onClick={() => void choose(false)}>{t('composer.attachFile')}</button>
      <button type="button" disabled={!available} onClick={() => void choose(true)}>{t('composer.attachFolder')}</button>
      <span className="composer-note">{t(dropUnavailable ? 'attachments.fallback' : 'attachments.hint')}</span>
    </div>
  </div>;
}
