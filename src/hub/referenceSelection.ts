import { msg, errorText, HubError, type HubText } from './i18n';
import { selectFiles, selectFolder } from '../../.runner/web-app-desktop/io/nativeIO';
import { commandNamed, controlTiming, clipboardMaxBytes, type RunnerControl } from './runnerControl';

export type ReferenceRequest = { operation: 'references.register'; path: string }
  | { operation: 'references.list'; offset: number }
  | { operation: 'references.remove'; reference_id: string };
export type ReferenceAdmission = { state: 'admitted'; id: number } | { state: 'failure' | 'outcome-unknown'; detail: HubText };
export type Reference = { reference_id: string; display_index: number; display_name: string;
  kind: string; image_detail: string | null; media_kind: string | null };
export type Inventory = { total_count: number; offset: number; next_offset: number | null; references: Reference[] };
export type ReferenceResult = { id: number; operation: string; offset: number;
  state: 'sending' | 'queued' | 'pending-interaction' | 'registered' | 'removed' | 'accepted' | 'rejected' | 'failure' | 'outcome-unknown';
  code?: string | null; registrationStatus?: string | null; reference?: Reference | null; inventory?: Inventory | null;
  referenceId?: string | null; removalStatus?: string | null };
export type ReferenceSnapshot = { capability: { version: number; inventory_page_size: number; image_details: string[] } | null;
  removalCapability?: { version: number } | null; results: ReferenceResult[] };
type CandidateState = 'capturing' | 'staged' | 'registering' | 'queued' | 'pending-interaction'
  | 'registered' | 'removing' | 'removed' | 'rejected' | 'failed' | 'cancelled' | 'outcome-unknown';
export type Candidate = { key: number; path: string; sessionId?: string; source?: 'clipboard';
  phase: CandidateState; requestId?: number; removalId?: number; cancelRequested?: boolean; removalBlocked?: boolean;
  reconciled?: boolean; submitted?: boolean; thumbnail?: string; image?: Blob; detail?: HubText };
const pending = (state: string) => ['sending', 'queued', 'pending-interaction'].includes(state);
const identity = (items: Reference[]) => items.map(item => item.reference_id).join(',');
const inactive = (state: string) => ['removed', 'cancelled'].includes(state);

// Selection, previews and receipt correlation are process-local. Runner owns committed references.
export class RunnerReferenceSelection {
  candidates: Candidate[] = [];
  registering = false;
  staging = false;
  listing = false;
  error: HubText = '';
  pendingSet?: Reference[];
  otherPending: Reference[] = [];
  private reviewedOthers = '';
  private sequence = 0;
  private picking = 0;
  private disposed = false;
  private submission?: { lease: symbol; candidates: Candidate[]; verified: boolean };
  private frozen = false;
  constructor(private owner: RunnerControl | undefined, private readonly changed: () => void) {}
  get control() { if (!this.owner) throw new HubError(msg('runtime.control.ownerUnavailable')); return this.owner; }
  bind(control: RunnerControl) {
    if (this.owner && this.owner !== control) throw new HubError(msg('runtime.references.originChanged'));
    this.owner = control;
    this.candidates.forEach(item => { item.sessionId ??= control.sessionId; });
  }
  unbind() {
    if (this.candidates.some(item => this.state(item) === 'outcome-unknown'
      || item.requestId !== undefined && !inactive(this.state(item)))) return false;
    this.candidates.forEach(item => {
      if (inactive(this.state(item))) { item.phase = 'cancelled'; item.requestId = undefined; item.removalId = undefined; }
      else if (item.phase === 'failed' && item.requestId === undefined) item.phase = 'staged';
    });
    this.owner = undefined;
    this.candidates.forEach(item => { item.sessionId = undefined; item.path = item.image ? '' : item.path; });
    return true;
  }
  freeze() { if (this.locked || this.picking || this.staging) throw new HubError(msg('runtime.references.finishEditing')); this.frozen = true; }
  get capable() { return !!this.owner?.snapshot.references?.capability; }
  get removable() { return !!this.control.snapshot.references?.removalCapability; }
  get locked() { return this.frozen || !!this.submission; }
  get deliveryLease() { return this.submission?.verified ? this.submission.lease : undefined; }
  get paths() { return this.candidates.map(item => item.path); }
  get results() { return this.owner?.snapshot.references?.results ?? []; }
  get inventoryResult() { return [...this.results].reverse().find(result => !!result.inventory); }
  get inventory() { return this.inventoryResult?.inventory; }
  get available() {
    return !this.disposed && !this.locked && !this.owner?.assignmentLocked
      && !this.registering && !this.listing && !this.staging && !this.picking;
  }
  move(key: number, offset: number) {
    if (!this.available) return;
    const index = this.candidates.findIndex(item => item.key === key), next = index + offset;
    if (index < 0 || next < 0 || next >= this.candidates.length) return;
    [this.candidates[index], this.candidates[next]] = [this.candidates[next], this.candidates[index]];
    this.changed();
  }
  result(candidate: Candidate) { return this.results.find(result => result.id === candidate.requestId); }
  referenceId(candidate: Candidate) { return this.result(candidate)?.reference?.reference_id; }
  state(candidate: Candidate): CandidateState {
    if (candidate.reconciled || candidate.phase === 'cancelled') return candidate.reconciled ? 'removed' : 'cancelled';
    if (candidate.removalBlocked) return 'outcome-unknown';
    if (candidate.removalId !== undefined) {
      const removal = this.results.find(result => result.id === candidate.removalId);
      if (!removal || pending(removal.state)) return removal?.state === 'pending-interaction' ? 'pending-interaction' : 'removing';
      if (removal.state === 'removed') return removal.referenceId === this.referenceId(candidate) ? 'removed' : 'outcome-unknown';
      return removal.state === 'outcome-unknown' ? 'outcome-unknown' : 'failed';
    }
    const result = this.result(candidate);
    if (!result) return candidate.phase;
    if (candidate.cancelRequested && result.state === 'registered') return candidate.phase === 'removing' ? 'removing' : 'outcome-unknown';
    if (result.state === 'sending') return 'registering';
    if (result.state === 'failure') return 'failed';
    if (result.state === 'rejected' && result.code === 'REFERENCE_SELECTION_CANCELLED') return 'cancelled';
    return result.state === 'accepted' || result.state === 'removed' ? 'outcome-unknown' : result.state;
  }
  private releasePreview(candidate: Candidate) {
    if (candidate.thumbnail) URL.revokeObjectURL(candidate.thumbnail);
    candidate.thumbnail = undefined;
  }
  select(paths: string[]) {
    if (this.locked || this.owner?.assignmentLocked || this.disposed) {
      this.error = msg('runtime.references.locked'); this.changed(); return;
    }
    this.candidates = this.candidates.filter(item => item.phase !== 'cancelled' || item.requestId !== undefined);
    for (const path of paths.slice(0, Math.max(0, 128 - this.candidates.length)))
      this.candidates.push({ key: ++this.sequence, path, sessionId: this.owner?.sessionId, phase: 'staged' });
    this.error = ''; this.changed();
  }
  async choose(folder: boolean) {
    if (!this.available) throw new HubError(msg('runtime.references.finishChoosing'));
    this.picking++; this.changed();
    try {
      const result = await (folder ? selectFolder() : selectFiles(true));
      if (result && !this.disposed) this.select(Array.isArray(result) ? result : [result]);
    } finally {
      this.picking--; this.changed();
    }
  }
  async captureImage(image: Blob) {
    if (!this.available || this.candidates.filter(item => !item.submitted && !inactive(this.state(item))).length >= 16) return;
    const candidate: Candidate = { key: ++this.sequence, path: '', sessionId: this.owner?.sessionId,
      source: 'clipboard', phase: 'capturing' };
    this.candidates.push(candidate);
    this.staging = true; this.error = ''; this.changed();
    try {
      if (image.type !== 'image/png' || !image.size || image.size > clipboardMaxBytes)
        throw new HubError(msg('runtime.control.clipboardUnsupported'));
      candidate.image = image.slice(0, image.size, image.type);
      candidate.thumbnail = URL.createObjectURL(candidate.image);
      candidate.phase = 'staged';
    } catch (reason) {
      candidate.phase = candidate.cancelRequested ? 'cancelled' : 'failed';
      candidate.detail = msg('runtime.withDiagnostic', { message: msg('runtime.references.clipboardFailed'), diagnostic: errorText(reason) });
      this.error = candidate.detail;
    } finally { this.staging = false; this.changed(); }
  }
  private async settled(id: number) {
    let deadline = performance.now() + controlTiming.completionMs;
    for (;;) {
      const result = this.results.find(item => item.id === id);
      if (result && !pending(result.state)) return result;
      if (result?.state === 'pending-interaction') deadline = performance.now() + controlTiming.completionMs;
      if (this.disposed || this.control.snapshot.state === 'disconnected' || performance.now() > deadline)
        throw new HubError(msg('runtime.references.receiptUnknown'));
      await new Promise(resolve => setTimeout(resolve, controlTiming.settleMs));
    }
  }
  private async register(candidate: Candidate, lease?: symbol) {
    if (candidate.cancelRequested || this.state(candidate) !== 'staged') return;
    candidate.phase = 'registering'; this.changed();
    try {
      const admission = await this.control.reference({ operation: 'references.register', path: candidate.path }, candidate.sessionId, lease);
      if (admission.state !== 'admitted') {
        candidate.phase = admission.state === 'failure' ? 'failed' : 'outcome-unknown';
        candidate.detail = admission.detail; return;
      }
      candidate.requestId = admission.id;
      await this.settled(admission.id);
      if (candidate.cancelRequested) {
        if (this.result(candidate)?.state === 'registered') await this.remove(candidate, lease);
        else if (['rejected', 'failure'].includes(this.result(candidate)?.state ?? '')) candidate.phase = 'cancelled';
      }
    } catch (reason) {
      candidate.phase = 'outcome-unknown';
      candidate.detail = msg('runtime.withDiagnostic', { message: msg('runtime.references.registrationUnknown'), diagnostic: errorText(reason) });
    } finally { this.changed(); }
  }
  async cancel(key: number) {
    const candidate = this.candidates.find(item => item.key === key);
    if (!candidate || candidate.submitted || candidate.cancelRequested || this.locked || this.owner?.assignmentLocked) return;
    candidate.cancelRequested = true; this.releasePreview(candidate); this.changed();
    const state = this.state(candidate);
    if (candidate.phase === 'capturing' || pending(this.result(candidate)?.state ?? '')
      || candidate.phase === 'registering' && candidate.requestId === undefined) return;
    if (this.referenceId(candidate)) await this.remove(candidate);
    else if (state !== 'outcome-unknown') { candidate.phase = 'cancelled'; candidate.image = undefined; }
    this.changed();
  }
  private async remove(candidate: Candidate, lease?: symbol) {
    const reference_id = this.referenceId(candidate);
    if (!reference_id || candidate.removalId !== undefined) return;
    if (!this.removable) {
      candidate.removalBlocked = true;
      candidate.phase = 'outcome-unknown';
      candidate.detail = msg('runtime.references.manualRemoval');
      this.changed(); return;
    }
    candidate.phase = 'removing'; this.changed();
    try {
      const admission = await this.control.reference({ operation: 'references.remove', reference_id }, candidate.sessionId, lease);
      if (admission.state !== 'admitted') {
        candidate.removalBlocked = true; candidate.detail = admission.detail; candidate.phase = 'outcome-unknown'; return;
      }
      candidate.removalId = admission.id;
      const result = await this.settled(admission.id);
      if (result.state !== 'removed' || result.referenceId !== reference_id)
        candidate.detail = msg('runtime.references.removalUnconfirmed');
    } catch (reason) {
      candidate.removalBlocked = candidate.removalId === undefined;
      candidate.phase = 'outcome-unknown'; candidate.detail = msg('runtime.withDiagnostic', { message: msg('runtime.references.removalUnknown'), diagnostic: errorText(reason) });
    } finally { this.changed(); }
  }
  private async readInventory(offset: number, lease?: symbol) {
    const admission = await this.control.reference({ operation: 'references.list', offset }, this.control.sessionId, lease);
    if (admission.state !== 'admitted') throw new HubError(admission.detail);
    const result = await this.settled(admission.id);
    if (result.state !== 'accepted' || !result.inventory) throw new HubError(msg('runtime.references.inventoryUnverified'));
    return result.inventory;
  }
  private ready() {
    if (!this.control.observationFresh || !commandNamed(this.control.snapshot, '/files')?.enabled
      || this.control.snapshot.observation?.attention.foreground_interaction_active)
      throw new HubError(msg('runtime.references.finishInteraction'));
  }
  private async stableInventory(lease?: symbol) {
    const pageSize = this.control.snapshot.references?.capability?.inventory_page_size ?? 0;
    const scan = async () => {
      const references: Reference[] = [];
      let total: number | undefined;
      for (;;) {
        const page = await this.readInventory(references.length, lease);
        if (!pageSize || page.total_count > 4096 || (total !== undefined && page.total_count !== total)
          || page.offset !== references.length || page.references.length > pageSize
          || page.references.some((item, index) => item.display_index !== references.length + index + 1
            || !/^[0-9a-f]{32}$/.test(item.reference_id)))
          throw new HubError(msg('runtime.references.paginationChanged'));
        total = page.total_count;
        references.push(...page.references);
        if (new Set(references.map(item => item.reference_id)).size !== references.length || references.length > total)
          throw new HubError(msg('runtime.references.identitiesInconsistent'));
        if (page.next_offset === null) {
          if (references.length !== total) throw new HubError(msg('runtime.references.inventoryIncomplete'));
          return references;
        }
        if (!page.references.length || page.next_offset !== references.length)
          throw new HubError(msg('runtime.references.inventoryNoProgress'));
      }
    };
    await this.control.fresh(); this.ready();
    const first = await scan();
    await this.control.fresh(); this.ready();
    const second = await scan();
    await this.control.fresh(); this.ready();
    if (JSON.stringify(first) !== JSON.stringify(second))
      throw new HubError(msg('runtime.references.samplesChanged'));
    this.pendingSet = second;
    for (const candidate of this.candidates) {
      const id = this.referenceId(candidate), removal = this.results.find(item => item.id === candidate.removalId);
      if (candidate.cancelRequested && id && !second.some(item => item.reference_id === id)
        && (!removal || !pending(removal.state))) candidate.reconciled = true;
    }
    this.changed();
    return second;
  }
  async refresh(offset = 0) {
    if (!this.capable || !this.available) return;
    this.listing = true; this.error = ''; this.changed();
    try {
      if (offset) await this.readInventory(offset);
      else await this.stableInventory();
    } catch (reason) { this.error = errorText(reason); }
    finally { this.listing = false; this.changed(); }
  }
  reviewOtherPending() {
    if (this.locked) return;
    this.reviewedOthers = identity(this.otherPending); this.error = ''; this.changed();
  }
  private unresolvedResults() {
    return this.results.some(result => {
      if (result.operation === 'references.list') return pending(result.state);
      if (!pending(result.state) && result.state !== 'outcome-unknown') return false;
      return !this.candidates.some(item => item.removalId === result.id && item.reconciled);
    });
  }
  async preflight() {
    this.bind(this.control);
    if (this.picking || this.staging || this.registering || this.listing || this.submission)
      throw new HubError(msg('runtime.references.finishEditing'));
    if (!this.capable) {
      if (this.candidates.some(item => !item.submitted && !inactive(this.state(item))))
        throw new HubError(msg('runtime.control.referenceUnavailable'));
      return;
    }
    if (this.unresolvedResults() || this.candidates.some(item => this.state(item) === 'outcome-unknown'))
      throw new HubError(msg('runtime.references.unresolved'));
    if (this.candidates.some(item => !item.cancelRequested && item.removalId !== undefined && this.state(item) === 'removed'))
      throw new HubError(msg('runtime.references.cancelFailed'));
    const lease = this.control.reserveAttachments();
    const selected = this.candidates.filter(item => !item.submitted && !item.cancelRequested && !inactive(this.state(item)));
    this.submission = { lease, candidates: selected, verified: false }; this.changed();
    if (selected.some(item => !['staged', 'registered'].includes(this.state(item))))
      throw new HubError(msg('runtime.references.cancelFailed'));
    const before = await this.stableInventory(lease);
    const excluded = this.candidates.filter(item => item.cancelRequested || inactive(this.state(item)))
      .map(item => this.referenceId(item)).filter((id): id is string => !!id);
    if (before.some(item => excluded.includes(item.reference_id)))
      throw new HubError(msg('runtime.references.cancelledPending'));
    const owned = selected.map(item => this.referenceId(item)).filter((id): id is string => !!id);
    this.otherPending = before.filter(item => !owned.includes(item.reference_id));
    if (identity(this.otherPending) !== this.reviewedOthers) {
      this.changed();
      throw new HubError(msg('runtime.references.reviewOthers'));
    }
    this.registering = true; this.changed();
    try {
      for (const candidate of selected) {
        if (candidate.image && !candidate.path) {
          const source = await this.control.stageImage(candidate.image, lease);
          if (source.sessionId !== candidate.sessionId) throw new HubError(msg('runtime.references.originChanged'));
          candidate.path = source.path;
        }
      }
      for (const candidate of selected) {
        await this.register(candidate, lease);
        if (this.state(candidate) !== 'registered' || !this.referenceId(candidate))
          throw new HubError(msg('runtime.references.registrationIncomplete'));
      }
    } finally { this.registering = false; this.changed(); }
    const after = await this.stableInventory(lease);
    const intended = selected.map(item => this.referenceId(item)!);
    const expected = [...this.otherPending.map(item => item.reference_id), ...intended];
    if (new Set(intended).size !== intended.length || intended.some(id => !after.some(item => item.reference_id === id))
      || identity(after) !== expected.join(',') || after.some(item => excluded.includes(item.reference_id)))
      throw new HubError(msg('runtime.references.finalMismatch'));
    this.submission.verified = true;
  }
  assertReadyForDelivery() {
    if (!this.capable) return;
    this.ready();
    if (!this.submission?.verified || this.unresolvedResults())
      throw new HubError(msg('runtime.references.verificationIncomplete'));
  }
  async reconcile(key: number) {
    if (this.locked || !this.owner) return;
    const candidate = this.candidates.find(item => item.key === key);
    if (!candidate || candidate.submitted) return;
    if (this.referenceId(candidate)) {
      await this.remove(candidate);
      if (this.state(candidate) !== 'removed') return;
    } else if (!['rejected', 'failed'].includes(this.state(candidate))) return;
    candidate.requestId = undefined; candidate.removalId = undefined;
    candidate.cancelRequested = false; candidate.reconciled = false;
    candidate.phase = 'staged'; candidate.detail = undefined;
    this.changed();
  }
  finishSubmission(delivered: boolean) {
    this.frozen = false;
    const submission = this.submission;
    if (!submission) return;
    if (delivered) {
      for (const candidate of submission.candidates) {
        candidate.submitted = true; candidate.image = undefined; this.releasePreview(candidate);
      }
      this.reviewedOthers = ''; this.otherPending = [];
    }
    this.submission = undefined; this.control.releaseAttachments(submission.lease); this.changed();
  }
  get prepared() {
    if (this.picking || this.staging || this.registering || this.listing || this.locked || this.unresolvedResults()
      || this.candidates.some(item => !item.submitted && !inactive(this.state(item)))) return true;
    const sampled = this.inventoryResult;
    if (sampled?.inventory?.total_count) return true;
    return this.results.some(item => item.state === 'registered' && item.id > (sampled?.id ?? 0));
  }
  async verifyAssignment() {
    if (this.prepared) throw new HubError(msg('runtime.references.prepared'));
    if (!this.capable) return;
    const result = await this.readInventory(0);
    if (result.total_count !== 0 || this.prepared)
      throw new HubError(msg('runtime.references.assignmentPending'));
  }
  dispose() {
    this.disposed = true;
    this.candidates.forEach(item => {
      this.releasePreview(item);
      item.image = undefined;
      if (['capturing', 'staged'].includes(item.phase)) { item.phase = 'cancelled'; item.cancelRequested = true; }
    });
  }
}
