import { msg, errorText, HubError, type HubText } from './i18n';
import { projectEntryDefaults } from './preferences';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed, type RunnerObservation } from './runnerControl';

type Target = RunnerObservation['target'];
type Model = Pick<RunnerObservation['selection'], 'model' | 'reasoning_effort' | 'service_tier'>;
export type EntryDefaults = { target?: Target; model?: Model; account?: string; runMode?: string };
export function entryDefaultValue<K extends keyof EntryDefaults>(observation: RunnerObservation, key: K): EntryDefaults[K] {
  const values: EntryDefaults = { target: observation.target, account: observation.selection.account, runMode: observation.run_mode,
    model: { model: observation.selection.model, reasoning_effort: observation.selection.reasoning_effort,
      service_tier: observation.selection.service_tier } };
  return values[key];
}
export type EntryPhase = 'editing' | 'preparing' | 'writing' | 'incomplete' | 'delivered' | 'unknown';

// /target availability is Runner-owned proof that retained Task/Issue authority
// has been released. /files additionally excludes recovery and auto-resume.
export function idleReason(session: RunnerSession) {
  const control = session.control, snapshot = control.snapshot, observation = snapshot.observation;
  if (!control.observationFresh || !observation) return msg('runtime.entry.freshUnavailable');
  if (session.references.prepared) return msg('runtime.entry.referencesPrepared');
  const { execution, attention } = observation;
  if (execution.lifecycle_state !== 'INTERACTIVE_READY' || execution.owned_execution_alive !== false
    || execution.workflow_kind !== '') return msg('runtime.entry.authorityActive');
  if (attention.foreground_interaction_active !== false || attention.restart_confirmation_required !== false
    || attention.termination_confirmation_active !== false || attention.account_setup_required !== false
    || attention.awaiting_user_command_reason !== '' || attention.suspension_status !== 'inactive'
    || attention.suspension_reason !== '') return msg('runtime.entry.attentionUnsettled');
  if (control.sending || snapshot.results.some(result =>
    ['sending', 'queued', 'pending-interaction', 'outcome-unknown'].includes(result.state))) return msg('runtime.entry.controlUnsettled');
  if (!commandNamed(snapshot, '/target')?.enabled || !commandNamed(snapshot, '/files')?.enabled)
    return msg('runtime.entry.releaseUnconfirmed');
  return '';
}

export function settingsMismatch(defaults: EntryDefaults, observation: RunnerObservation) {
  const changes: HubText[] = [];
  if (defaults.target && (defaults.target.binding_state !== observation.target.binding_state
    || defaults.target.owner !== observation.target.owner || defaults.target.project !== observation.target.project)) changes.push('/target');
  const selected = observation.selection, model = defaults.model;
  if (model && (model.model !== selected.model || model.reasoning_effort !== selected.reasoning_effort
    || model.service_tier !== selected.service_tier || model.model !== selected.next_model
    || model.reasoning_effort !== selected.next_reasoning_effort || model.service_tier !== selected.next_service_tier)) changes.push('/model');
  if (defaults.account !== undefined && defaults.account !== selected.account) changes.push('/account');
  if (defaults.runMode !== undefined && defaults.runMode !== observation.run_mode) changes.push('/run-mode');
  if (!model && (selected.model !== selected.next_model || selected.reasoning_effort !== selected.next_reasoning_effort
    || selected.service_tier !== selected.next_service_tier)) changes.push(msg('runtime.entry.modelNextMismatch'));
  return changes;
}

export class SingleEntry {
  draft = '';
  defaults: EntryDefaults = {};
  phase: EntryPhase = 'editing';
  detail: HubText = '';
  runnerId?: string;
  evidence: HubText[] = [];
  private active?: { session: RunnerSession; token: symbol };
  constructor(private readonly list: () => readonly RunnerSession[],
    private readonly create: (location: string, token: symbol) => { session: RunnerSession; launched: Promise<void> },
    private readonly changed: () => void, defaults: EntryDefaults = {},
    private readonly saveDefaults: (value: EntryDefaults) => void = () => {}) {
    this.defaults = projectEntryDefaults(defaults) ?? {};
    this.restoredDefaults = Object.keys(this.defaults).length > 0;
  }
  readonly restoredDefaults: boolean;
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
    const projected = projectEntryDefaults({ ...this.defaults, [key]: value });
    if (!projected || value !== undefined && !this.observed.some(({ observation }) =>
      JSON.stringify(entryDefaultValue(observation, key)) === JSON.stringify(value))) return;
    this.defaults = projected;
    this.saveDefaults(projected);
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
    this.detail = msg('runtime.entry.checking');
    this.evidence = [];
    this.runnerId = undefined;
    this.changed();
    try {
      let session = this.list().find(candidate => {
        const reason = !candidate.assignmentAvailable ? msg('runtime.entry.inputUnsettled') : idleReason(candidate);
        if (reason) this.evidence.push(msg('runtime.entry.excluded', { name: candidate.view.name, id: candidate.view.id, reason }));
        return !reason;
      });
      if (session) {
        if (!session.reserve(token)) throw new HubError(msg('runtime.entry.reservationUnavailable'));
        this.active = { session, token };
        this.runnerId = session.view.id;
        this.evidence.push(msg('runtime.entry.reused', { name: session.view.name, id: session.view.id, order: session.view.createdOrder }));
      } else {
        if (!location) throw new HubError(msg('runtime.entry.noEligible'));
        const created = this.create(location, token);
        session = created.session;
        this.active = { session, token };
        this.runnerId = session.view.id;
        this.detail = msg('runtime.entry.starting', { name: session.view.name });
        this.evidence.push(msg('runtime.entry.created', { name: session.view.name, id: session.view.id, order: session.view.createdOrder }));
        this.changed();
        await created.launched;
        if (session.view.status !== 'running') throw new HubError(session.view.detail || msg('runtime.entry.launchFailed'));
      }
      await session.control.fresh();
      const reason = idleReason(session);
      if (reason) throw new HubError(msg('runtime.entry.unsent', { reason }));
      await session.references.verifyAssignment();
      const afterInventory = idleReason(session);
      if (afterInventory) throw new HubError(msg('runtime.entry.unsent', { reason: afterInventory }));
      const snapshot = session.control.snapshot, observation = snapshot.observation!;
      this.evidence.push(msg('runtime.entry.authenticated', { serial: snapshot.observationSerial }));
      if (!observation.selection.account || !observation.selection.model || !observation.selection.source || !observation.run_mode)
        throw new HubError(msg('runtime.entry.settingsIncomplete'));
      const mismatch = settingsMismatch(defaults, observation);
      if (mismatch.length) throw new HubError(msg('runtime.entry.settingsMismatch', { commands: mismatch.reduce<HubText>((previous, item) => previous ? msg('common.list', { previous, item }) : item, '') }));
      this.evidence.push(msg('runtime.entry.confirmed', { settings: JSON.stringify({ target: observation.target, selection: observation.selection, runMode: observation.run_mode }) }));
      this.phase = 'writing';
      this.detail = msg('runtime.entry.sending', { name: session.view.name });
      this.changed();
      const result = await session.deliver(token, text);
      this.detail = msg('runtime.entry.result', { name: session.view.name, detail: result.detail });
      this.phase = result.delivered ? 'delivered' : 'unknown';
      if (result.delivered) {
        this.draft = '';
        session.release(token);
        this.active = undefined;
      }
      this.evidence.push(this.detail);
    } catch (reason) {
      this.phase = 'incomplete';
      this.detail = errorText(reason);
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
    this.detail = transfer ? msg('runtime.entry.transferred') : msg('runtime.entry.released');
    this.changed();
  }
}
