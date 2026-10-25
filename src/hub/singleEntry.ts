import type { RunnerSession } from './RunnerSessions';
import { commandNamed, type RunnerObservation } from './runnerControl';

type Target = RunnerObservation['target'];
type Model = Pick<RunnerObservation['selection'], 'model' | 'reasoning_effort' | 'service_tier'>;
export type EntryDefaults = { target?: Target; model?: Model; account?: string; runMode?: string };
export type EntryPhase = 'editing' | 'preparing' | 'writing' | 'incomplete' | 'delivered' | 'unknown';

// /target availability is Runner-owned proof that retained Task/Issue authority
// has been released. /files additionally excludes recovery and auto-resume.
export function idleReason(session: RunnerSession) {
  const control = session.control, snapshot = control.snapshot, observation = snapshot.observation;
  if (!control.observationFresh || !observation) return 'Fresh authenticated observation unavailable';
  if (session.references.prepared) return 'References are prepared for another Runner interaction';
  const { execution, attention } = observation;
  if (execution.lifecycle_state !== 'INTERACTIVE_READY' || execution.owned_execution_alive !== false
    || execution.workflow_kind !== '') return 'Execution authority is active or uncertain';
  if (attention.foreground_interaction_active !== false || attention.restart_confirmation_required !== false
    || attention.termination_confirmation_active !== false || attention.account_setup_required !== false
    || attention.awaiting_user_command_reason !== '' || attention.suspension_status !== 'inactive'
    || attention.suspension_reason !== '') return 'Runner attention or suspension is unsettled';
  if (control.sending || snapshot.results.some(result =>
    ['sending', 'queued', 'pending-interaction', 'outcome-unknown'].includes(result.state))) return 'Control outcome unsettled';
  if (!commandNamed(snapshot, '/target')?.enabled || !commandNamed(snapshot, '/files')?.enabled)
    return 'Runner has not confirmed released work authority and an available instruction surface';
  return '';
}

export function settingsMismatch(defaults: EntryDefaults, observation: RunnerObservation) {
  const changes: string[] = [];
  if (defaults.target && (defaults.target.binding_state !== observation.target.binding_state
    || defaults.target.owner !== observation.target.owner || defaults.target.project !== observation.target.project)) changes.push('/target');
  const selected = observation.selection, model = defaults.model;
  if (model && (model.model !== selected.model || model.reasoning_effort !== selected.reasoning_effort
    || model.service_tier !== selected.service_tier || model.model !== selected.next_model
    || model.reasoning_effort !== selected.next_reasoning_effort || model.service_tier !== selected.next_service_tier)) changes.push('/model');
  if (defaults.account !== undefined && defaults.account !== selected.account) changes.push('/account');
  if (defaults.runMode !== undefined && defaults.runMode !== observation.run_mode) changes.push('/run-mode');
  if (!model && (selected.model !== selected.next_model || selected.reasoning_effort !== selected.next_reasoning_effort
    || selected.service_tier !== selected.next_service_tier)) changes.push('/model (effective and next settings differ)');
  return changes;
}

export class SingleEntry {
  draft = '';
  defaults: EntryDefaults = {};
  phase: EntryPhase = 'editing';
  detail = '';
  runnerId?: string;
  evidence: string[] = [];
  private active?: { session: RunnerSession; token: symbol };
  constructor(private readonly list: () => readonly RunnerSession[],
    private readonly create: (location: string, token: symbol) => { session: RunnerSession; launched: Promise<void> },
    private readonly changed: () => void) {}
  get pending() { return this.phase === 'preparing' || this.phase === 'writing'; }
  get editable() { return this.phase === 'editing' || this.phase === 'delivered'; }
  setDraft(value: string) {
    if (!this.editable) return;
    this.draft = value;
    this.phase = 'editing';
    this.changed();
  }
  setDefault<K extends keyof EntryDefaults>(key: K, value: EntryDefaults[K]) {
    if (!this.editable) return;
    this.defaults = { ...this.defaults, [key]: value };
    this.changed();
  }
  get observed() {
    return this.list().filter(session => session.control.observationFresh)
      .map(session => ({ name: session.view.name, observation: session.control.snapshot.observation! }));
  }
  async submit(location?: string) {
    if (!this.editable || !this.draft.trim()) return;
    const text = this.draft, defaults = this.defaults, token = Symbol('Single Entry submission');
    this.phase = 'preparing';
    this.detail = 'Checking Runner readiness and settings…';
    this.evidence = [];
    this.runnerId = undefined;
    this.changed();
    try {
      let session = this.list().find(candidate => {
        const reason = !candidate.assignmentAvailable ? 'Input ownership, draft, process or dispatch is unsettled' : idleReason(candidate);
        if (reason) this.evidence.push(`Excluded ${candidate.view.name} (${candidate.view.id}): ${reason}`);
        return !reason;
      });
      if (session) {
        if (!session.reserve(token)) throw new Error('Runner reservation unavailable. Instruction unsent.');
        this.active = { session, token };
        this.runnerId = session.view.id;
        this.evidence.push(`Reused ${session.view.name} (${session.view.id}), creation order ${session.view.createdOrder}`);
      } else {
        if (!location) throw new Error('No eligible Runner. Verify an installation to create one. Instruction unsent.');
        const created = this.create(location, token);
        session = created.session;
        this.active = { session, token };
        this.runnerId = session.view.id;
        this.detail = `Starting ${session.view.name} and waiting for verified readiness…`;
        this.evidence.push(`Created ${session.view.name} (${session.view.id}), creation order ${session.view.createdOrder}`);
        this.changed();
        await created.launched;
        if (session.view.status !== 'running') throw new Error(session.view.detail || 'Runner launch failed. Instruction unsent.');
      }
      await session.control.fresh();
      const reason = idleReason(session);
      if (reason) throw new Error(`${reason}. Instruction unsent.`);
      await session.references.verifyAssignment();
      const afterInventory = idleReason(session);
      if (afterInventory) throw new Error(`${afterInventory}. Instruction unsent.`);
      const snapshot = session.control.snapshot, observation = snapshot.observation!;
      this.evidence.push(`Authenticated observation ${snapshot.observationSerial}: INTERACTIVE_READY; no execution, workflow, attention, suspension or unsettled control; /target and /files enabled; untouched Hub input and empty composer.`);
      if (!observation.selection.account || !observation.selection.model || !observation.selection.source || !observation.run_mode)
        throw new Error('Effective Runner settings are incomplete. Instruction unsent.');
      const mismatch = settingsMismatch(defaults, observation);
      if (mismatch.length) throw new Error(`Settings need terminal interaction: ${mismatch.join(', ')}. Open this Runner and use its settings menus. Instruction unsent; no menu answers were supplied.`);
      this.evidence.push(`Confirmed settings: ${JSON.stringify({ target: observation.target, selection: observation.selection, runMode: observation.run_mode })}`);
      this.phase = 'writing';
      this.detail = `Sending once to ${session.view.name}…`;
      this.changed();
      const result = await session.deliver(token, text);
      this.detail = `${session.view.name}: ${result.detail}`;
      this.phase = result.delivered ? 'delivered' : 'unknown';
      if (result.delivered) {
        this.draft = '';
        session.release(token);
        this.active = undefined;
      }
      this.evidence.push(this.detail);
    } catch (reason) {
      this.phase = 'incomplete';
      this.detail = String(reason);
      this.evidence.push(this.detail);
    } finally {
      if (this.active) this.active.session.control.assignmentLocked = false;
      this.changed();
    }
  }
  releaseUnsent(transfer = false) {
    if (this.phase !== 'incomplete') return;
    if (this.active) {
      const { session, token } = this.active;
      session.release(token);
      if (transfer && !session.view.draft) { session.setDraft(this.draft); this.draft = ''; }
      this.active = undefined;
    }
    this.phase = 'editing';
    this.detail = transfer ? 'Unsent instruction transferred to the Runner composer.' : 'Unsent assignment released. Draft retained.';
    this.changed();
  }
}
