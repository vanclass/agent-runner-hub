import { msg, errorText, HubError, type HubText } from './i18n';
import { HubSelections } from './HubSelections';
import type { RunnerSession } from './RunnerSessions';
import { commandNamed, isRunnerCommand, type RunnerObservation, type CommandAttempt } from './runnerControl';
import { submitConfiguredWork } from './runnerSubmission';
import { copy, type ConfigAccount } from './runnerConfigContract';
import type { WorkAttempt } from './runnerWork';
import type { BriefResult } from './RunnerBrief';
import { RunnerReferenceSelection } from './referenceSelection';

type Target = RunnerObservation['target'];
type Model = Pick<RunnerObservation['selection'], 'model' | 'reasoning_effort' | 'service_tier'>;
export type EntryDefaults = { target?: Target; model?: Model; accountIdentity?: ConfigAccount;
  runMode?: string; root?: string; allocationPolicy?: 'always-new' | 'reuse-idle' | 'reuse-same-mode'; initialized?: true };

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
  private submissionToken?: symbol;
  private active?: { session: RunnerSession; token: symbol; text: string; attempt?: WorkAttempt; command?: CommandAttempt };
  constructor(private readonly list: () => readonly RunnerSession[],
    private readonly create: (location: string, token: symbol) => { session: RunnerSession; launched: Promise<void>; promoted?: boolean },
    private readonly changed: () => void, defaults: EntryDefaults = {},
    saveDefaults: (value: EntryDefaults) => void = () => {},
    optionsSource: () => RunnerSession | undefined = () => this.list()[0],
    private readonly affiliation: (id: string) => string | undefined = () => undefined) {
    this.selections = new HubSelections(() => optionsSource()?.control.config, changed, defaults, saveDefaults, () => this.editable,
      service => {
        const control = optionsSource()?.control;
        return control?.config === service && control.observationFresh ? control.snapshot.observation : undefined;
      });
    this.attachments = new RunnerReferenceSelection(undefined, changed);
  }
  get allocationPolicy() { return this.defaults.allocationPolicy ?? 'always-new'; }
  get pending() { return this.phase === 'preparing' || this.phase === 'writing'; }
  get progress() { return this.pending && this.active?.session.control.brief.busy
    ? this.active.session.control.brief.detail : this.detail; }
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
    this.submissionToken = token;
    this.phase = 'preparing';
    this.detail = msg('runtime.entry.checking');
    this.runnerId = undefined;
    this.changed();
    let attempted = false;
    try {
      let session: RunnerSession | undefined;
      if (this.allocationPolicy !== 'always-new') {
        for (const candidate of this.list()) {
          if (candidate.assignmentReserved) continue;
          if (candidate.control.work.current && candidate.control.work.supported && !candidate.control.work.busy) {
            try { await candidate.control.work.refreshStatus(); } catch { continue; }
          }
          if (!candidate.assignmentAvailable) continue;
          try { await candidate.control.fresh(); } catch { continue; }
          const reason = idleReason(candidate);
          if (reason || !candidate.assignmentAvailable) continue;
          if (this.allocationPolicy === 'reuse-same-mode'
            && (!defaults.runMode || this.affiliation(candidate.view.id) !== defaults.runMode)) continue;
          if (!candidate.reserve(token)) continue;
          session = candidate;
          break;
        }
      }
      let launched: Promise<void> | undefined;
      if (!session) {
        if (!location) throw new HubError(msg('runtime.entry.noEligible'));
        const created = this.create(location, token);
        session = created.session;
        launched = created.launched;
      }
      this.active = { session, token, text };
      this.runnerId = session.view.id;
      focus(this.runnerId);
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
      if (!briefRun && isRunnerCommand(text)) {
        if (this.attachments.candidates.some(item => !item.submitted && !['cancelled', 'removed'].includes(this.attachments.state(item))))
          throw new HubError(msg('attachments.instructionOnly'));
        attempted = true;
        const result = await session.deliver(token, text);
        const command = result.attempt;
        attempted = !!command && command.state !== 'not-sent';
        this.active.command = command;
        this.phase = !attempted ? 'incomplete' : command?.state === 'pending' ? 'writing' : 'unknown';
        this.detail = result.detail;
        this.observe();
        return;
      }
      if (!briefRun && !session.control.work.supported) throw new HubError(msg('work.unavailable'));
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
        this.phase = result.status === 'completed' ? 'delivered' : attempted ? 'unknown' : 'incomplete';
        if (result.status === 'completed') {
          if (this.draft === text) this.draft = '';
          this.attachments.finishSubmission(true);
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
        if (this.draft === text) this.draft = '';
        this.attachments.finishSubmission(true);
        this.attachments = new RunnerReferenceSelection(undefined, this.changed);
        session.release(token);
        this.active = undefined;
      } else {
        this.phase = 'unknown';
        this.detail = msg('work.retained', { state: attempt.work?.state || 'unknown' });
      }
    } catch (reason) {
      this.phase = attempted ? 'unknown' : 'incomplete';
      this.detail = errorText(reason);
    } finally {
      if (!attempted && this.submissionToken === token) this.settleUnsent(token);
      if (this.active?.token === token) this.active.session.control.assignmentLocked = false;
      this.changed();
    }
  }
  private settleUnsent(token: symbol) {
    if (this.submissionToken !== token || this.active && this.active.token !== token) return;
    const active = this.active;
    this.active = undefined;
    this.attachments.finishSubmission(false);
    if (!this.attachments.unbind()) {
      this.active = active;
      this.detail = msg('runtime.references.unresolved'); return;
    }
    this.phase = 'editing';
    active?.session.release(token);
    this.changed();
  }
  observe() {
    if (this.phase === 'incomplete' && this.active) this.settleUnsent(this.active.token);
    const active = this.active, attempt = active?.attempt;
    const command = active?.command;
    if (active && command && ['writing', 'unknown'].includes(this.phase)) {
      if (command.state === 'unknown') this.phase = 'unknown';
      if (command.state !== 'completed') return;
      if (command.result?.state === 'accepted') {
        this.active = undefined;
        this.phase = 'delivered';
        if (this.draft === active.text) this.draft = '';
        this.attachments.finishSubmission(false);
        active.session.release(active.token);
      } else {
        this.phase = 'incomplete';
        this.detail = msg('work.rejected', { code: command.result?.code || '' });
        this.settleUnsent(active.token);
      }
      this.changed(); return;
    }
    if (this.phase !== 'unknown' || !active || !attempt) return;
    if (!attempt.uncertain && (attempt.notSent || attempt.work?.admission === 'rejected' && !attempt.work.started_event_id)) {
      this.phase = 'incomplete';
      this.detail = msg('work.rejected', { code: attempt.work?.code || attempt.submission?.code || '' });
      this.settleUnsent(active.token);
      return;
    }
    if (!attempt.work?.started_event_id) return;
    this.active = undefined;
    this.phase = 'delivered';
    if (this.draft === active.text) this.draft = '';
    this.attachments.finishSubmission(true);
    this.attachments = new RunnerReferenceSelection(undefined, this.changed);
    this.detail = msg('work.started', { name: active.session.view.name, event: attempt.work.started_event_id });
    active.session.release(active.token);
  }
}
