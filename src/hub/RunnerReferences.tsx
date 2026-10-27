import { useHubTranslation, t, tr, errorText, type HubText } from './i18n';
import { useEffect, useState } from 'react';
import { watchFileDrop } from '../../.runner/web-app-desktop/io/nativeIO';
import { commandNamed, type RunnerControl } from './runnerControl';
import type { RunnerReferenceSelection } from './referenceSelection';
export function RunnerReferences({ control, selection }: { control: RunnerControl; selection: RunnerReferenceSelection }) {
  useHubTranslation();
  const [error, setError] = useState<HubText>('');
  const files = commandNamed(control.snapshot, '/files');
  const available = selection.available;
  const unavailable = files?.disabled_reason || t('references.filesUnavailable');
  const inventory = selection.inventory;
  const pending = selection.pendingSet ?? inventory?.references;
  const foreground = selection.results.some(result => result.state === 'pending-interaction');
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve().then(() => watchFileDrop(paths => {
      if (disposed) return;
      if (available) { selection.select(paths); setError(''); }
      else setError(unavailable);
    })).then(stop => { if (disposed) void Promise.resolve(stop()).catch(() => {}); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; void Promise.resolve(unlisten?.()).catch(() => {}); };
  }, [available, unavailable, selection]);
  async function choose(folder: boolean) {
    setError('');
    try {
      await selection.choose(folder);
    } catch (reason) { setError(errorText(reason)); }
  }
  async function openFiles() {
    setError('');
    try { await control.command('/files'); }
    catch (reason) { setError(errorText(reason)); }
  }
  return <details className="runner-references" open={selection.staging || selection.paths.length > 0 || !!error || !!inventory || !!selection.error}>
    <summary>{t('references.title')}</summary>
    <div className="reference-actions">
      <button type="button" disabled={!available} title={available ? selection.capable ? t('references.registerFiles') : t('references.manualPaths') : unavailable}
        onClick={() => void choose(false)}>{t('references.chooseFiles')}</button>
      <button type="button" disabled={!available} title={available ? t('references.chooseFolderHint') : unavailable}
        onClick={() => void choose(true)}>{t('references.chooseFolder')}</button>
      <button type="button" disabled={!available} title={unavailable} onClick={() => void openFiles()}>{t('references.openFiles')}</button>
      <button type="button" disabled={!selection.clipboardAvailable}
        title={selection.clipboardAvailable ? t('references.captureHint')
          : selection.capable && !control.snapshot.clipboardStaging ? t('references.clipboardBuildUnavailable')
            : t('references.clipboardRequires')}
        onClick={() => void selection.captureClipboard()}>
        {selection.capable && control.snapshot.clipboardStaging ? t('references.clipboard') : t('references.clipboardUnavailable')}</button>
      {selection.capable && <>
        <button type="button" disabled={!available || !selection.candidates.some(item => item.source !== 'clipboard' && selection.state(item) === 'staged')}
          onClick={() => void selection.registerSelected()}>{t('references.registerSelected')}</button>
        <button type="button" disabled={!available} onClick={() => void selection.refresh()}>{t('references.reconcile')}</button>
      </>}
    </div>
    {selection.staging && <p role="status">{t('references.staging')}</p>}
    {(selection.registering || selection.listing) && <p role="status">{foreground
      ? t('references.continueTerminal')
      : selection.listing ? t('references.readingInventory') : t('references.registering')}</p>}
    <p>{selection.capable ? t('references.automaticHelp')
      : t('references.manualHelp')}</p>
    {selection.capable && pending && <section aria-label={t('references.pendingLabel')}>
      <h3>{t('references.pendingLabel')}</h3>
      {control.snapshot.state !== 'ready' && <p role="status">{t('references.lastSample')}</p>}
      <p>{t('references.pendingCount', { count: (selection.pendingSet ? pending.length : inventory?.total_count) ?? 0 })} · {selection.pendingSet
        ? t('references.matchingSamples') : t('references.lastPage')}</p>
      {pending.length === 0 && <p>{t('references.emptySample')}</p>}
      <ol>{pending.map(reference => <li key={reference.reference_id}>
        {reference.display_name} · {reference.kind}{reference.image_detail && t('references.detail', { detail: reference.image_detail })}{reference.media_kind && ` · ${reference.media_kind}`}
        <br /><code>{reference.reference_id}</code>
      </li>)}</ol>
    </section>}
    {selection.otherPending.length > 0 && <section aria-label={t('references.otherPending')}>
      <h3>{t('references.otherPending')}</h3>
      <p>{t('references.otherHelp')}</p>
      <ul>{selection.otherPending.map(reference => <li key={reference.reference_id}>
        {reference.display_name} · <code>{reference.reference_id}</code>
      </li>)}</ul>
      <button type="button" disabled={selection.locked} onClick={() => selection.reviewOtherPending()}>{t('references.includeOthers')}</button>
    </section>}
    {selection.candidates.length > 0 && <h3>{t('references.attachments')}</h3>}
    {selection.candidates.map(candidate => <div className="reference-candidate" key={candidate.key}>
      {candidate.source === 'clipboard' ? <div className="clipboard-candidate">
        {candidate.thumbnail && <img src={candidate.thumbnail} alt={t('references.clipboardPreview', { index: candidate.key })} width="80" height="60" />}
        <strong>{t('references.clipboardNumber', { index: candidate.key })}</strong>
      </div> : <label className="reference-path">{t('references.selectedPath')}
        <input aria-label={t('references.selectedNamed', { path: candidate.path })} readOnly value={candidate.path} onFocus={event => event.currentTarget.select()} /></label>}
      <p role="status">{candidate.submitted ? t('references.delivered') : referenceState(selection.state(candidate))}
        {selection.referenceId(candidate) && <> · {t('references.id')} <code>{selection.referenceId(candidate)}</code></>}
        {selection.result(candidate)?.code && <> · {selection.result(candidate)!.code}</>}
        {candidate.cancelRequested && !['removed', 'cancelled'].includes(selection.state(candidate)) && <> · {t('references.cancellationPending')}</>}
        {candidate.detail && <> · {tr(candidate.detail)}</>}</p>
      {!candidate.submitted && !['removed', 'cancelled'].includes(selection.state(candidate)) && <button type="button"
        disabled={selection.locked || control.assignmentLocked || candidate.cancelRequested}
        onClick={() => void selection.cancel(candidate.key)}>
        {selection.referenceId(candidate) ? t('references.remove') : t('references.cancel')} {candidate.source === 'clipboard' ? t('references.image') : t('references.path')} {candidate.key}
      </button>}
    </div>)}
    {selection.candidates.length > 0 && <button type="button" disabled={selection.locked}
      title={t('references.clearHint')}
      onClick={() => selection.clearHistory()}>{t('references.clear')}</button>}
    {selection.locked && <p role="status">{t('references.locked')}</p>}
    {selection.capable ? <>
      {!pending && <p>{t('references.unread')}</p>}
      <p>{t('references.clipboardStagedHelp')} {selection.removable
        ? t('references.removalById')
        : t('references.manualRemoval')} {t('references.sourcesLifetime')}</p>
    </> : <p>{t('references.unconfirmedPaths')}</p>}
    {error && <p role="alert">{tr(error)}</p>}
    {selection.error && <p role="alert">{tr(selection.error)}</p>}
  </details>;
}

function referenceState(state: string) {
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
    default: return state;
  }
}
