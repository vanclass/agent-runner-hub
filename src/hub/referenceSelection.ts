import { selectFiles, selectFolder } from '../../.runner/web-app-desktop/io/nativeIO';
import { commandNamed, type RunnerControl } from './runnerControl';

export type ReferenceRequest = { operation: 'references.register'; path: string }
  | { operation: 'references.list'; offset: number };
export type ReferenceAdmission = { state: 'admitted'; id: number } | { state: 'failure' | 'outcome-unknown'; detail: string };
export type Reference = { reference_id: string; display_index: number; display_name: string;
  kind: string; image_detail: string | null; media_kind: string | null };
export type Inventory = { total_count: number; offset: number; next_offset: number | null; references: Reference[] };
export type ReferenceResult = { id: number; operation: string; offset: number;
  state: 'sending' | 'queued' | 'pending-interaction' | 'registered' | 'accepted' | 'rejected' | 'failure' | 'outcome-unknown';
  code?: string | null; registrationStatus?: string | null; reference?: Reference | null; inventory?: Inventory | null };
export type ReferenceSnapshot = { capability: { version: number; inventory_page_size: number; image_details: string[] } | null;
  results: ReferenceResult[] };
type Candidate = { key: number; path: string; requestId?: number; admission: 'selected' | 'sending' | 'failure' | 'outcome-unknown'; detail?: string };
const pending = (state: string) => ['sending', 'queued', 'pending-interaction'].includes(state);

// Process-local candidates and receipt correlation only. Runner owns registration and lifetime.
export class RunnerReferenceSelection {
  candidates: Candidate[] = [];
  registering = false;
  listing = false;
  error = '';
  private sequence = 0;
  private picking = 0;
  constructor(readonly control: RunnerControl, private readonly changed: () => void) {}
  get capable() { return !!this.control.snapshot.references?.capability; }
  get paths() { return this.candidates.map(item => item.path); }
  get results() { return this.control.snapshot.references?.results ?? []; }
  get inventoryResult() { return [...this.results].reverse().find(result => !!result.inventory); }
  get inventory() { return this.inventoryResult?.inventory; }
  get available() {
    return this.control.snapshot.state === 'ready' && !!commandNamed(this.control.snapshot, '/files')?.enabled
      && !this.control.busy && !this.registering && !this.listing;
  }
  result(candidate: Candidate) { return this.results.find(result => result.id === candidate.requestId); }
  state(candidate: Candidate) { return this.result(candidate)?.state ?? candidate.admission; }
  select(paths: string[]) {
    if (this.control.assignmentLocked) { this.error = 'Single Entry holds this Runner. Paths were not submitted.'; this.changed(); return; }
    if (!this.capable) this.candidates = [];
    for (const path of paths) this.candidates.push({ key: ++this.sequence, path, admission: 'selected' });
    this.error = ''; this.changed();
    if (this.capable && this.available) void this.registerSelected();
  }
  clear() {
    // Clearing presentation never removes Runner references or unresolved native receipts.
    this.candidates = this.candidates.filter(item => pending(this.state(item)) || this.state(item) === 'outcome-unknown');
    this.changed();
  }
  async choose(folder: boolean) {
    if (!this.available) throw new Error('Finish the Runner interaction before choosing paths.');
    this.picking++; this.changed();
    try {
      const result = await (folder ? selectFolder() : selectFiles(true));
      if (result) this.select(Array.isArray(result) ? result : [result]);
    } finally { this.picking--; this.changed(); }
  }
  private async settled(id: number) {
    for (;;) {
      const result = this.results.find(item => item.id === id);
      if (result && !pending(result.state)) return result;
      if (this.control.snapshot.state === 'disconnected') throw new Error('Runner disconnected; outcome unknown. Registration was not repeated.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  async registerSelected() {
    if (!this.capable || !this.available) return;
    const selected = this.candidates.filter(item => item.admission === 'selected' && item.requestId === undefined);
    this.registering = true; this.error = ''; this.changed();
    try {
      for (const candidate of selected) {
        if (!this.candidates.includes(candidate)) continue;
        if (this.control.snapshot.state !== 'ready') break;
        candidate.admission = 'sending'; this.changed();
        try {
          const admission = await this.control.reference({ operation: 'references.register', path: candidate.path });
          if (admission.state !== 'admitted') {
            candidate.admission = admission.state; candidate.detail = admission.detail;
            if (admission.state === 'outcome-unknown') break;
            continue;
          }
          candidate.requestId = admission.id;
          const result = await this.settled(candidate.requestId);
          if (result.state === 'outcome-unknown') break;
        } catch (reason) {
          // A lost invoke/admission receipt can hide a sent request. Never infer non-submission.
          candidate.admission = 'outcome-unknown'; candidate.detail = String(reason);
          this.error = candidate.detail; break;
        } finally { this.changed(); }
      }
    } finally { this.registering = false; this.changed(); }
  }
  async refresh(offset = 0) {
    if (!this.capable || !this.available) return;
    this.listing = true; this.error = ''; this.changed();
    try {
      const result = await this.readInventory(offset);
      if (result.state !== 'accepted') this.error = `Inventory ${result.state}${result.code ? `: ${result.code}` : ''}. Refresh when /files is available.`;
    } catch (reason) { this.error = String(reason); }
    finally { this.listing = false; this.changed(); }
  }
  private async readInventory(offset: number) {
    const admission = await this.control.reference({ operation: 'references.list', offset });
    if (admission.state !== 'admitted') throw new Error(admission.detail);
    return this.settled(admission.id);
  }
  get prepared() {
    if (this.picking || this.registering || this.listing || this.candidates.some(item =>
      ['selected', 'sending', 'queued', 'pending-interaction', 'outcome-unknown'].includes(this.state(item)))) return true;
    if (this.results.some(item => item.operation === 'references.register' &&
      (pending(item.state) || item.state === 'outcome-unknown'))) return true;
    const sampled = this.inventoryResult;
    if (sampled?.inventory?.total_count) return true;
    return this.results.some(item => item.state === 'registered' && item.id > (sampled?.id ?? 0));
  }
  async verifyAssignment() {
    if (this.prepared) throw new Error('This Runner has prepared references or an unresolved reference interaction. Instruction unsent.');
    if (!this.capable) return;
    const result = await this.readInventory(0);
    if (result.state !== 'accepted' || !result.inventory || result.inventory.total_count !== 0 || this.prepared)
      throw new Error('Runner pending references are present or unverified. Use this Runner directly for the intended instruction. Single Entry instruction unsent.');
  }
}
