import { msg, errorText, HubError, type HubText } from './i18n';
import { HubSelections } from './HubSelections';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed, type RunnerObservation } from './runnerControl';
import { submitConfiguredWork } from './runnerSubmission';
import { copy, type ConfigAccount } from './runnerConfigContract';
import type { WorkAttempt } from './runnerWork';
import type { BriefResult } from './RunnerBrief';
import { RunnerReferenceSelection } from './referenceSelection';

type Target = RunnerObservation['target'];
type Model = Pick<RunnerObservation['selection'], 'model' | 'reasoning_effort' | 'service_tier'>;
export type EntryDefaults = { target?: Target; model?: Model; account?: string; accountIdentity?: ConfigAccount;
  runMode?: string; root?: string; allocationPolicy?: 'always-new' | 'reuse-idle'; initialized?: true };

export type EntryPhase = 'editing' | 'preparing' | 'writing' | 'incomplete' | 'delivered' | 'unknown';

// /target availability is Runner-owned proof that retained Task/Issue authority
// has been released. /files additionally excludes recovery and auto-resume.
export function idleReason(session: RunnerSession, allowReferences = false) {
  const control = session.control, snapshot = control.snapshot, observation = snapshot.observation;
  if (control.brief.blocked || control.brief.busy) return msg('runtime.entry.controlUnsettled');
  if (!control.observationFresh || !observation) return msg('runtime.entry.freshUnavailable');
  if (!allowReferences && session.references.prepared) return msg('runtime.entry.referencesPrepared');
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

export class SingleEntry {
  draft = '';
  readonly selections: HubSelections;
  attachments: RunnerReferenceSelection;
  get defaults() { return this.selections.defaults; }
  get catalog() { return this.selections.catalog; }
  get loadingOptions() { return this.selections.loadingOptions; }
  get restoredDefaults() { return this.selections.restoredDefaults; }
  phase: EntryPhase = 'editing';
  detail: HubText = '';
  runnerId?: string;
  evidence: HubText[] = [];
  private active?: { session: RunnerSession; token: symbol; attempt?: WorkAttempt };
  constructor(private readonly list: () => readonly RunnerSession[],
    private readonly create: (location: string, token: symbol) => { session: RunnerSession; launched: Promise<void>; promoted?: boolean },
    private readonly changed: () => void, defaults: EntryDefaults = {},
    saveDefaults: (value: EntryDefaults) => void = () => {},
    optionsSource: () => RunnerSession | undefined = () => this.list()[0]) {
    this.selections = new HubSelections(() => optionsSource()?.control.config, changed, defaults, saveDefaults, () => this.editable);
    this.attachments = new RunnerReferenceSelection(undefined, changed);
  }
  get allocationPolicy() { return this.defaults.allocationPolicy ?? 'always-new'; }
  get pending() { return this.phase === 'preparing' || this.phase === 'writing'; }
  get editable() { return this.phase === 'editing' || this.phase === 'delivered'; }
  setDraft(value: string) {
    if (!this.editable) return;
    this.draft = value;
    this.phase = 'editing';
    this.changed();
  }
  setDefault<K extends keyof EntryDefaults>(key: K, value: EntryDefaults[K]) { this.selections.setDefault(key, value); }
  inspectOptions() { return this.selections.inspectOptions(); }
  async submit(location?: string, focus: (id: string) => void = () => {}, briefRun = false) {
    if (!this.editable || this.loadingOptions || !this.draft.trim()) return;
    if (briefRun && this.defaults.runMode !== 'issue-run') return;
    const text = this.draft, defaults = copy(this.defaults), token = Symbol('Single Entry submission');
    try { this.attachments.freeze(); } catch (reason) { this.detail = errorText(reason); this.changed(); return; }
    this.phase = 'preparing';
    this.detail = msg('runtime.entry.checking');
    this.evidence = [];
    this.runnerId = undefined;
    this.changed();
    let attempted = false;
    try {
      let session: RunnerSession | undefined;
      if (this.allocationPolicy === 'reuse-idle') {
        for (const candidate of this.list()) {
          if (candidate.assignmentReserved) continue;
          if (candidate.control.work.current && candidate.control.work.supported && !candidate.control.work.busy) {
            try { await candidate.control.work.refreshStatus(); } catch { continue; }
          }
          if (!candidate.assignmentAvailable) continue;
          try { await candidate.control.fresh(); } catch { continue; }
          const reason = idleReason(candidate);
          if (reason || !candidate.assignmentAvailable) continue;
          if (!candidate.reserve(token)) continue;
          session = candidate;
          break;
        }
      }
      let launched: Promise<void> | undefined;
      let promoted = false;
      if (!session) {
        if (!location) throw new HubError(msg('runtime.entry.noEligible'));
        const created = this.create(location, token);
        session = created.session;
        launched = created.launched;
        promoted = created.promoted === true;
      }
      this.active = { session, token };
      this.runnerId = session.view.id;
      focus(this.runnerId);
      this.evidence.push(msg(promoted ? 'work.promoted' : launched ? 'runtime.entry.created' : 'runtime.entry.reused',
        { name: session.view.name, id: session.view.id, order: session.view.createdOrder }));
      this.detail = msg('work.configuring', { name: session.view.name });
      this.changed();
      await launched;
      if (session.view.status !== 'running') throw new HubError(session.view.detail || msg('runtime.entry.launchFailed'));
      await session.control.fresh();
      const reason = idleReason(session);
      if (reason) throw new HubError(msg('runtime.entry.unsent', { reason }));
      await session.references.verifyAssignment();
      const inventoryReason = idleReason(session);
      if (inventoryReason || !session.ownsAssignment(token)) throw new HubError(msg('runtime.entry.unsent',
        { reason: inventoryReason || msg('runtime.entry.inputUnsettled') }));
      if (!briefRun && text.trimStart().startsWith('/')) {
        if (this.attachments.candidates.some(item => !item.submitted && !['cancelled', 'removed'].includes(this.attachments.state(item))))
          throw new HubError(msg('attachments.instructionOnly'));
        attempted = true;
        const result = await session.deliver(token, text);
        this.phase = result.delivered ? 'delivered' : 'unknown';
        this.detail = result.detail;
        if (result.delivered) {
          this.draft = ''; session.release(token); this.active = undefined;
          this.attachments.finishSubmission(false);
        }
        return;
      }
      if (!session.control.work.supported) throw new HubError(msg('work.unavailable'));
      const destination = session;
      this.attachments.bind(destination.control);
      const previous = session.control.work.current;
      const submission = submitConfiguredWork<WorkAttempt | BriefResult>(session.control.config, session.control.work, defaults, text, async () => {
        await destination.control.fresh();
        await destination.references.verifyAssignment();
        const finalReason = idleReason(destination);
        if (finalReason || !destination.ownsAssignment(token)) throw new HubError(msg('runtime.entry.unsent',
          { reason: finalReason || msg('runtime.entry.inputUnsettled') }));
        destination.control.assignmentLocked = false;
        await this.attachments.preflight();
        await destination.control.fresh();
        this.attachments.assertReadyForDelivery();
        const attachmentReason = idleReason(destination, true);
        if (attachmentReason || !destination.ownsAssignment(token, this.attachments.deliveryLease)) throw new HubError(msg('runtime.entry.unsent',
          { reason: attachmentReason || msg('runtime.entry.inputUnsettled') }));
        this.phase = 'writing';
        this.detail = msg('work.observing', { name: destination.view.name });
        attempted = true;
        this.changed();
        return this.attachments.deliveryLease;
      }, briefRun ? lease => destination.control.brief.submit(text, lease) : undefined);
      if (briefRun) {
        const result = await submission as BriefResult;
        attempted = result.staged || result.status === 'unknown';
        this.detail = destination.control.brief.detail;
        this.evidence.push(this.detail);
        this.phase = result.status === 'completed' ? 'delivered' : attempted ? 'unknown' : 'incomplete';
        if (result.status === 'completed') {
          this.draft = ''; this.attachments.finishSubmission(true);
          this.attachments = new RunnerReferenceSelection(undefined, this.changed);
          session.release(token); this.active = undefined;
        }
        return;
      }
      let attempt: WorkAttempt;
      try { attempt = await submission as WorkAttempt; }
      finally {
        attempted = attempted && session.control.work.current !== previous;
        if (attempted && this.active) this.active.attempt = session.control.work.current;
      }
      if (attempt.notSent || attempt.work?.admission === 'rejected' && !attempt.work.started_event_id) {
        attempted = false;
        this.phase = 'incomplete';
        this.detail = msg('work.rejected', { code: attempt.work?.code || attempt.submission?.code || '' });
      } else if (attempt.work?.started_event_id) {
        this.phase = 'delivered';
        this.detail = msg('work.started', { name: session.view.name, event: attempt.work.started_event_id });
        this.draft = '';
        this.attachments.finishSubmission(true);
        this.attachments = new RunnerReferenceSelection(undefined, this.changed);
        session.release(token);
        this.active = undefined;
        this.evidence.push(this.detail);
      } else {
        this.phase = 'unknown';
        this.detail = msg('work.retained', { state: attempt.work?.state || 'unknown' });
      }
    } catch (reason) {
      this.phase = attempted ? 'unknown' : 'incomplete';
      this.detail = errorText(reason);
    } finally {
      if (!attempted) this.attachments.finishSubmission(false);
      if (this.active) this.active.session.control.assignmentLocked = false;
      this.changed();
    }
  }
  releaseUnsent(transfer = false) {
    if (this.phase !== 'incomplete') return;
    this.attachments.finishSubmission(false);
    if (!this.attachments.unbind()) {
      this.detail = msg('runtime.references.unresolved'); this.changed(); return;
    }
    if (transfer && this.attachments.candidates.some(item => !item.submitted && item.phase !== 'cancelled')) {
      this.detail = msg('runtime.references.finishEditing'); this.changed(); return;
    }
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
  observe() {
    const active = this.active, attempt = active?.attempt;
    if (this.phase !== 'unknown' || !active || !attempt) return;
    if (!attempt.uncertain && (attempt.notSent || attempt.work?.admission === 'rejected' && !attempt.work.started_event_id)) {
      this.attachments.finishSubmission(false);
      this.phase = 'incomplete';
      this.detail = msg('work.rejected', { code: attempt.work?.code || attempt.submission?.code || '' });
      return;
    }
    if (!attempt.work?.started_event_id) return;
    this.active = undefined;
    this.phase = 'delivered'; this.draft = '';
    this.attachments.finishSubmission(true);
    this.attachments = new RunnerReferenceSelection(undefined, this.changed);
    this.detail = msg('work.started', { name: active.session.view.name, event: attempt.work.started_event_id });
    this.evidence.push(this.detail);
    active.session.release(active.token);
  }
}
