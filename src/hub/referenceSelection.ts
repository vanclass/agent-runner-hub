import { selectFiles, selectFolder } from '../../.runner/web-app-desktop/io/nativeIO';
import { commandNamed, type RunnerControl } from './runnerControl';

export type ReferenceRequest = { operation: 'references.register'; path: string }
  | { operation: 'references.list'; offset: number }
  | { operation: 'references.remove'; reference_id: string };
export type ReferenceAdmission = { state: 'admitted'; id: number } | { state: 'failure' | 'outcome-unknown'; detail: string };
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
  phase: CandidateState; requestId?: number; removalId?: number; cancelRequested?: boolean;
  reconciled?: boolean; submitted?: boolean; thumbnail?: string; detail?: string };
const pending = (state: string) => ['sending', 'queued', 'pending-interaction'].includes(state);
const identity = (items: Reference[]) => items.map(item => item.reference_id).join(',');
const inactive = (state: string) => ['removed', 'cancelled'].includes(state);

// Selection, previews and receipt correlation are process-local. Runner owns committed references.
export class RunnerReferenceSelection {
  candidates: Candidate[] = [];
  registering = false;
  staging = false;
  listing = false;
  error = '';
  pendingSet?: Reference[];
  otherPending: Reference[] = [];
  private reviewedOthers = '';
  private sequence = 0;
  private picking = 0;
  private disposed = false;
  private submission?: { lease: symbol; candidates: Candidate[]; verified: boolean };
  constructor(readonly control: RunnerControl, private readonly changed: () => void) {}
  get capable() { return !!this.control.snapshot.references?.capability; }
  get removable() { return !!this.control.snapshot.references?.removalCapability; }
  get locked() { return !!this.submission; }
  get paths() { return this.candidates.map(item => item.path); }
  get results() { return this.control.snapshot.references?.results ?? []; }
  get inventoryResult() { return [...this.results].reverse().find(result => !!result.inventory); }
  get inventory() { return this.inventoryResult?.inventory; }
  get available() {
    return !this.disposed && !this.locked && this.control.snapshot.state === 'ready'
      && !!commandNamed(this.control.snapshot, '/files')?.enabled && !this.control.busy
      && !this.registering && !this.listing && !this.staging && !this.picking;
  }
  get clipboardAvailable() {
    return this.capable && this.control.snapshot.clipboardStaging === true && this.available
      && this.candidates.length < 128 && this.candidates.filter(item => !item.submitted && !inactive(this.state(item))).length < 16
      && this.control.observationFresh && !this.control.snapshot.observation?.attention.foreground_interaction_active;
  }
  result(candidate: Candidate) { return this.results.find(result => result.id === candidate.requestId); }
  referenceId(candidate: Candidate) { return this.result(candidate)?.reference?.reference_id; }
  state(candidate: Candidate): CandidateState {
    if (candidate.reconciled || candidate.phase === 'cancelled') return candidate.reconciled ? 'removed' : 'cancelled';
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
    if (this.locked || this.control.assignmentLocked || this.disposed) {
      this.error = 'This Runner selection is locked. Paths were not submitted.'; this.changed(); return;
    }
    if (!this.capable) this.candidates = [];
    for (const path of paths.slice(0, Math.max(0, 128 - this.candidates.length)))
      this.candidates.push({ key: ++this.sequence, path, sessionId: this.control.sessionId, phase: 'staged' });
    this.error = ''; this.changed();
    if (this.capable && this.available) void this.registerSelected();
  }
  clearHistory() {
    if (this.locked) return;
    this.candidates = this.candidates.filter(item => {
      const clear = item.submitted || inactive(this.state(item));
      if (clear) this.releasePreview(item);
      return !clear;
    });
    this.changed();
  }
  async choose(folder: boolean) {
    if (!this.available) throw new Error('Finish the Runner interaction before choosing paths.');
    this.picking++; this.changed();
    try {
      const result = await (folder ? selectFolder() : selectFiles(true));
      if (result && !this.disposed) this.select(Array.isArray(result) ? result : [result]);
    } finally {
      this.picking--; this.changed();
      if (this.capable && this.available) void this.registerSelected();
    }
  }
  async captureClipboard() {
    if (!this.clipboardAvailable) return;
    const candidate: Candidate = { key: ++this.sequence, path: '', sessionId: this.control.sessionId,
      source: 'clipboard', phase: 'capturing' };
    this.candidates.push(candidate);
    this.staging = true; this.error = ''; this.changed();
    try {
      const source = await this.control.clipboardSource();
      if (source.sessionId !== candidate.sessionId) throw new Error('The originating Runner changed.');
      candidate.path = source.path;
      if (this.disposed || candidate.cancelRequested || this.control.snapshot.state === 'disconnected') candidate.phase = 'cancelled';
      else { candidate.thumbnail = URL.createObjectURL(source.thumbnail); candidate.phase = 'staged'; }
    } catch {
      candidate.phase = candidate.cancelRequested ? 'cancelled' : 'failed';
      candidate.detail = 'No image was registered. Copy a supported image to the Windows clipboard and try Clipboard image again; check Runner availability and the session staging limit.';
      this.error = candidate.detail;
    } finally { this.staging = false; this.changed(); }
  }
  private async settled(id: number) {
    let deadline = performance.now() + 65000;
    for (;;) {
      const result = this.results.find(item => item.id === id);
      if (result && !pending(result.state)) return result;
      if (result?.state === 'pending-interaction') deadline = performance.now() + 65000;
      if (this.disposed || this.control.snapshot.state === 'disconnected' || performance.now() > deadline)
        throw new Error('Runner receipt unavailable; outcome unknown. The request was not repeated.');
      await new Promise(resolve => setTimeout(resolve, 50));
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
    } catch {
      candidate.phase = 'outcome-unknown';
      candidate.detail = 'Registration outcome unknown. Do not recapture or repeat this attempt to resolve it.';
    } finally { this.changed(); }
  }
  async registerSelected() {
    if (!this.capable || !this.available) return;
    const selected = this.candidates.filter(item => item.source !== 'clipboard' && this.state(item) === 'staged');
    this.registering = true; this.error = ''; this.changed();
    try {
      for (const candidate of selected) {
        await this.register(candidate);
        if (!['registered', 'removed', 'cancelled'].includes(this.state(candidate))) break;
      }
    } finally { this.registering = false; this.changed(); }
  }
  async cancel(key: number) {
    const candidate = this.candidates.find(item => item.key === key);
    if (!candidate || candidate.submitted || candidate.cancelRequested || this.locked || this.control.assignmentLocked) return;
    candidate.cancelRequested = true; this.releasePreview(candidate); this.changed();
    const state = this.state(candidate);
    if (candidate.phase === 'capturing' || pending(this.result(candidate)?.state ?? '')
      || candidate.phase === 'registering' && candidate.requestId === undefined) return;
    if (this.referenceId(candidate)) await this.remove(candidate);
    else if (state !== 'outcome-unknown') candidate.phase = 'cancelled';
    this.changed();
  }
  private async remove(candidate: Candidate, lease?: symbol) {
    const reference_id = this.referenceId(candidate);
    if (!reference_id || candidate.removalId !== undefined) return;
    if (!this.removable) {
      candidate.phase = 'outcome-unknown';
      candidate.detail = 'Use /files → Remove in this Runner, then Reconcile pending references. This attachment remains unresolved.';
      this.changed(); return;
    }
    candidate.phase = 'removing'; this.changed();
    try {
      const admission = await this.control.reference({ operation: 'references.remove', reference_id }, candidate.sessionId, lease);
      if (admission.state !== 'admitted') {
        candidate.detail = admission.detail; candidate.phase = 'outcome-unknown'; return;
      }
      candidate.removalId = admission.id;
      const result = await this.settled(admission.id);
      if (result.state !== 'removed' || result.referenceId !== reference_id)
        candidate.detail = 'Removal is unconfirmed. Reconcile this exact ID in the owning Runner; instruction remains unsent.';
    } catch {
      candidate.phase = 'outcome-unknown'; candidate.detail = 'Removal outcome unknown. The request was not repeated.';
    } finally { this.changed(); }
  }
  private async readInventory(offset: number, lease?: symbol) {
    const admission = await this.control.reference({ operation: 'references.list', offset }, this.control.sessionId, lease);
    if (admission.state !== 'admitted') throw new Error(admission.detail);
    const result = await this.settled(admission.id);
    if (result.state !== 'accepted' || !result.inventory) throw new Error('Pending inventory is unverified. Instruction unsent.');
    return result.inventory;
  }
  private ready() {
    if (!this.control.observationFresh || !commandNamed(this.control.snapshot, '/files')?.enabled
      || this.control.snapshot.observation?.attention.foreground_interaction_active)
      throw new Error('Finish the Runner terminal interaction, then send again. Instruction unsent.');
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
          throw new Error('Pending references changed or pagination is unverified. Refresh and review before sending.');
        total = page.total_count;
        references.push(...page.references);
        if (new Set(references.map(item => item.reference_id)).size !== references.length || references.length > total)
          throw new Error('Pending reference identities are inconsistent. Instruction unsent.');
        if (page.next_offset === null) {
          if (references.length !== total) throw new Error('Pending inventory is incomplete. Instruction unsent.');
          return references;
        }
        if (!page.references.length || page.next_offset !== references.length)
          throw new Error('Pending inventory made no verified progress. Instruction unsent.');
      }
    };
    await this.control.fresh(); this.ready();
    const first = await scan();
    await this.control.fresh(); this.ready();
    const second = await scan();
    await this.control.fresh(); this.ready();
    if (JSON.stringify(first) !== JSON.stringify(second))
      throw new Error('Pending references changed between samples. Review and send again; instruction unsent.');
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
    } catch (reason) { this.error = String(reason); }
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
    if (this.picking || this.staging || this.registering || this.listing || this.locked)
      throw new Error('Finish attachment editing before sending. Instruction unsent.');
    if (!this.capable) return;
    if (this.unresolvedResults() || this.candidates.some(item => this.state(item) === 'outcome-unknown'))
      throw new Error('An attachment outcome is unresolved. Reconcile it in this Runner before sending; instruction unsent.');
    const lease = this.control.reserveAttachments();
    const selected = this.candidates.filter(item => !item.submitted && !item.cancelRequested && !inactive(this.state(item)));
    this.submission = { lease, candidates: selected, verified: false }; this.changed();
    if (selected.some(item => !['staged', 'registered'].includes(this.state(item))))
      throw new Error('An attachment failed or was rejected. Cancel that item before sending; instruction unsent.');
    const before = await this.stableInventory(lease);
    const excluded = this.candidates.filter(item => item.cancelRequested || inactive(this.state(item)))
      .map(item => this.referenceId(item)).filter((id): id is string => !!id);
    if (before.some(item => excluded.includes(item.reference_id)))
      throw new Error('A cancelled attachment is still pending in Runner. Remove it and reconcile before sending.');
    const owned = selected.map(item => this.referenceId(item)).filter((id): id is string => !!id);
    this.otherPending = before.filter(item => !owned.includes(item.reference_id));
    if (identity(this.otherPending) !== this.reviewedOthers) {
      this.changed();
      throw new Error('Review other pending references below, then choose Include other pending references before sending.');
    }
    this.registering = true; this.changed();
    try {
      for (const candidate of selected) {
        await this.register(candidate, lease);
        if (this.state(candidate) !== 'registered' || !this.referenceId(candidate))
          throw new Error('Attachment registration did not complete. Instruction unsent; completed receipts and draft retained.');
      }
    } finally { this.registering = false; this.changed(); }
    const after = await this.stableInventory(lease);
    const intended = selected.map(item => this.referenceId(item)!);
    const expected = [...before.map(item => item.reference_id), ...intended.filter(id => !before.some(item => item.reference_id === id))];
    if (new Set(intended).size !== intended.length || intended.some(id => !after.some(item => item.reference_id === id))
      || identity(after) !== expected.join(',') || after.some(item => excluded.includes(item.reference_id)))
      throw new Error('The final pending set does not match this selection. Reconcile and review before sending; instruction unsent.');
    this.submission.verified = true;
  }
  assertReadyForDelivery() {
    if (!this.capable) return;
    this.ready();
    if (!this.submission?.verified || this.unresolvedResults())
      throw new Error('Attachment verification is incomplete. Instruction unsent.');
  }
  finishSubmission(delivered: boolean) {
    const submission = this.submission;
    if (!submission) return;
    if (delivered) {
      for (const candidate of submission.candidates) { candidate.submitted = true; this.releasePreview(candidate); }
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
    if (this.prepared) throw new Error('This Runner has prepared references or an unresolved reference interaction. Instruction unsent.');
    if (!this.capable) return;
    const result = await this.readInventory(0);
    if (result.total_count !== 0 || this.prepared)
      throw new Error('Runner pending references are present or unverified. Use this Runner directly for the intended instruction. Single Entry instruction unsent.');
  }
  dispose() {
    this.disposed = true;
    this.candidates.forEach(item => {
      this.releasePreview(item);
      if (['capturing', 'staged'].includes(item.phase)) { item.phase = 'cancelled'; item.cancelRequested = true; }
    });
  }
}
