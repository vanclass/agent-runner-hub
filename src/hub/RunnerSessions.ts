import { msg, errorText, HubError } from './i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { openPty, type Pty } from '../../.project-config/managed/web-app-desktop/terminal/bridge';
import { RunnerInput } from './runnerInput';
import { RunnerControl, commandNamed, isRunnerCommand, typedRunArguments, type ControlSnapshot, type CommandAttempt } from './runnerControl';
import { RunnerReferenceSelection } from './referenceSelection';
import type { RunnerView } from './model';
import { SingleEntry, idleReason, type EntryDefaults } from './singleEntry';
import { submitConfiguredWork } from './runnerSubmission';
import { RunnerWorkspace, type RunnerTabRecord } from './RunnerWorkspace';
import type { RecoveryOutcome } from './RunnerRecovery';
import { RunnerNavigation, type DomainDisplay, type RunnerDrop, type RunMode } from './RunnerNavigation';
import { RunnerSpare, type SpareEvent } from './RunnerSpare';
import { RunnerRestarts, type RestartTarget, type RestartOutcome } from './RunnerRestarts';
import { launchFailure, type RunnerInstallation } from './runnerInstallation';
import { copy, same } from './runnerConfigContract';
import { issueSidebarActivity, issueUserAction, type WorkAttempt } from './runnerWork';
import type { BriefResult } from './RunnerBrief';
import { HubSelections } from './HubSelections';
import { InstructionHistory } from './instructionHistory';
import { terminalPalettes, type TerminalTheme } from './terminalTheme';
import '@xterm/xterm/css/xterm.css';

const recoveryMessages = {
  absent: 'lifecycle.recoveryOutcome.absent',
  blocked: 'lifecycle.recoveryOutcome.blocked',
  identity_conflict: 'lifecycle.recoveryOutcome.identity_conflict',
  interaction_required: 'lifecycle.recoveryOutcome.interaction_required',
  unverified: 'lifecycle.recoveryOutcome.unverified',
  partial: 'lifecycle.recoveryOutcome.partial',
} as const satisfies Record<Exclude<RecoveryOutcome, 'recovered'>, string>;

export class RunnerSession {
  readonly instructionHistory = new InstructionHistory();
  readonly terminal = new Terminal({ cursorBlink: false, scrollback: 10000,
    fontFamily: 'Consolas, "Malgun Gothic", Menlo, monospace',
    minimumContrastRatio: 4.5, theme: terminalPalettes.light });
  hubSelections?: HubSelections;
  private submittedAttempt?: { attempt: WorkAttempt; draft: string };
  private submittedCommand?: { attempt: CommandAttempt; draft: string };
  private submittedRun?: { tabId: string; draft: string; revision: number };
  private deliveredRunTab?: string;
  private draftRevision = 0;
  readonly fit = new FitAddon();
  readonly input: RunnerInput;
  readonly control: RunnerControl;
  readonly references: RunnerReferenceSelection;
  private pty?: Pty;
  private opening?: Promise<void>;
  private cleanup?: Promise<void>;
  private closing?: Promise<boolean>;
  private pending: Uint8Array[] = [];
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  unexpectedExit = false;
  private reservation?: symbol;
  private deliveryUnknown = false;
  private nativeState: 'not-created' | 'opening' | 'unknown' | 'open' | 'closing' | 'settled' | 'failed' = 'not-created';
  private nativeFailure?: string;
  private terminationIssue?: ReturnType<typeof errorText>;
  private connected = false;
  private readonly installationRoot: string;
  private get nativeSettled() { return this.nativeState === 'settled' || this.nativeState === 'not-created'; }
  get terminationSettled() { return this.nativeSettled; }
  get canRetryTermination() { return !!this.pty && !this.nativeSettled; }
  private get exitObserved() { return this.nativeState === 'settled' || this.nativeState === 'failed'; }
  get recoveryDiagnostic() {
    const { outcome, code, saved } = this.control.recovery;
    if (!outcome || !Object.hasOwn(recoveryMessages, outcome)) return;
    return msg('lifecycle.recovery', {
      cause: msg(recoveryMessages[outcome as keyof typeof recoveryMessages]), code: code ?? saved?.code,
    });
  }
  get diagnostics() {
    const recovery = this.control.recovery;
    const detail = this.view.detail;
    return [
      ['failed', 'exited'].includes(this.view.status) || typeof detail === 'object' && detail.key === 'lifecycle.initialization'
        ? detail : undefined,
      this.view.status === 'running' && !this.view.closing && this.control.snapshot.state === 'disconnected'
        ? msg('lifecycle.connection', { location: this.installationRoot, diagnostic: this.control.snapshot.detail }) : undefined,
      this.connected ? this.recoveryDiagnostic : undefined,
      recovery.history === 'incomplete' ? msg('lifecycle.historyIncomplete')
        : recovery.history === 'unverified' ? msg('lifecycle.historyUnverified') : undefined,
      this.terminationIssue,
    ].filter(Boolean);
  }
  get submissionUncertain() {
    return this.deliveryUnknown || this.control.commandUnresolved || this.control.brief.blocked || this.control.typedRun.uncertain;
  }
  get typedRunCanEdit() { return this.deliveredRunTab === this.view.id && this.control.typedRun.canEdit; }
  view: RunnerView;
  composerCompact = false;
  private tabRecord?: RunnerTabRecord;
  private presentationRetired = false;
  get tab() {
    if (!this.tabRecord) throw new Error('Hidden Runner has no workspace tab');
    const { recovery: _prior, ...tab } = this.tabRecord;
    return { ...tab, ...(this.control.recovery.saved ? { recovery: this.control.recovery.saved } : {}) };
  }
  get reusableIdle() { return !this.view.closing && this.idleForClose; }
  get restartReady() {
    const activity = this.control.work.activity;
    const inventory = this.control.work.progress;
    return !this.view.closing && activity !== 'unknown'
      && (activity !== 'attention' || this.retainedWorkloadSettled)
      && !(inventory?.operation === 'work.list' && inventory.state === 'outcome-unknown') && this.safeIdle(true);
  }
  get restartObservation() {
    const { snapshot, receivedAt } = this.control;
    return { key: JSON.stringify([this.view.status, this.view.closing,
      snapshot.state, snapshot.observation, this.control.work.activity, this.references.prepared]), observedAt: receivedAt };
  }
  retireTab() {
    this.control.tabClosing = true;
    this.control.recovery.discard();
    this.control.work.suspendDiscovery();
    this.hubSelections = undefined;
    this.tabRecord = undefined;
    this.instructionHistory.reset();
    this.update({ closing: true });
  }
  async verifyReusable() {
    if (!await this.verifyIdle(false)) return false;
    return !this.control.tabClosing || await this.control.recovery.verifyReleased() && this.safeIdle();
  }
  verifyRestart() { return this.verifyIdle(true); }
  private async verifyIdle(preserveDraft: boolean) {
    if (!this.safeIdle(preserveDraft)) return false;
    await this.control.fresh();
    if (!this.safeIdle(preserveDraft)) return false;
    const discovery = this.control.work.discoverySupported;
    await this.control.work.refreshInventory();
    const inventory = this.control.work.progress;
    if (discovery && (inventory?.operation !== 'work.list' || inventory.state !== 'accepted'
      || inventory.phase !== 'completed')) return false;
    if (!this.safeIdle(preserveDraft)) return false;
    const retainedWithoutFileAccess = preserveDraft && this.retainedWorkloadSettled
      && commandNamed(this.control.snapshot, '/files')?.enabled === false;
    if (!retainedWithoutFileAccess) await this.references.verifyAssignment();
    await this.control.fresh();
    return this.safeIdle(preserveDraft);
  }
  hide() {
    this.presentationRetired = true;
    this.tabRecord = undefined;
    this.control.recovery.discard();
    this.control.tabClosing = false;
    this.update({ closing: false });
  }

  constructor(tab: RunnerTabRecord | Pick<RunnerTabRecord, 'installationRoot'>,
    private changed: () => boolean | void, restored = false) {
    this.tabRecord = 'id' in tab ? tab : undefined;
    this.installationRoot = tab.installationRoot;
    // Empty display fields remain private until the workspace assigns a tab at promotion.
    this.view = { id: this.tabRecord?.id ?? '', createdOrder: this.tabRecord?.createdOrder ?? 0,
      name: this.tabRecord?.name ?? '', status: this.tabRecord?.launchOnOpen === false ? 'exited' : 'starting',
      canSubmit: false, draft: '', submitting: false };
    this.control = new RunnerControl(() => {
      if (!this.disposed) {
        this.connected ||= this.control.snapshot.state === 'ready';
        this.captureVerified(); this.observeSubmission(); this.syncTerminalInput(); return this.changed();
      }
    });
    const historicalModes = [this.tabRecord?.recoveryHint?.runMode, this.tabRecord?.lastVerified?.runMode]
      .filter((mode): mode is string => !!mode);
    this.control.recovery.restore(this.tabRecord?.recovery, restored && this.tabRecord?.launchOnOpen === true, historicalModes);
    if (restored && this.tabRecord?.launchOnOpen && !this.tabRecord.recovery && this.tabRecord.recoveryHint)
      this.control.recovery.legacy();
    this.references = new RunnerReferenceSelection(this.control, () => { if (!this.disposed) this.changed(); });
    this.terminal.loadAddon(this.fit);
    this.input = new RunnerInput(this.terminal, text => this.queue(new TextEncoder().encode(text)),
      () => this.protocolChanged());
    this.terminal.onWriteParsed(() => this.protocolChanged());
    this.terminal.onResize(({ cols, rows }) => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        if (this.view.status === 'running') void this.pty?.resize(cols, rows).catch(reason => this.error(reason));
      }, 30);
    });
  }
  private update(change: Partial<RunnerView>) { this.view = { ...this.view, ...change }; this.changed(); }
  private captureVerified() {
    const observation = this.control.snapshot.observation;
    const recovery = this.control.recovery;
    if (!this.tabRecord || !observation || !this.control.observationFresh || recovery.busy
      || recovery.saved?.reference && !recovery.saved.runMode) return;
    // Fresh settings do not confirm historical work recovery or retire its retained hint.
    this.tabRecord = { ...this.tabRecord, lastVerified: {
      target: { ...observation.target }, runMode: observation.run_mode,
      workflowKind: observation.execution.workflow_kind,
    } };
  }
  private protocolChanged() {
    if (this.input && this.view.canSubmit !== this.input.canSubmit) this.update({ canSubmit: this.input.canSubmit });
  }
  private error(reason: unknown) {
    if (!this.disposed && !this.exitObserved && !this.view.closing) this.update({ detail: errorText(reason) });
  }
  get foregroundInteraction() {
    return this.control.observationFresh && (!!this.control.snapshot.observation?.attention.foreground_interaction_active
      || this.control.config.progress?.state === 'pending-interaction'
      || this.control.work.progress?.state === 'pending-interaction'
      || this.control.snapshot.results.some(r => r.state === 'pending-interaction')
      || this.references.results.some(r => r.state === 'pending-interaction'));
  }
  private syncTerminalInput() {
    // disableStdin also suppresses xterm's protocol replies; gate only user editing.
    if (this.terminal.textarea) this.terminal.textarea.readOnly = true;
    this.terminal.options.cursorBlink = false;
  }
  get assignmentAvailable() {
    return !this.disposed && !this.view.closing && !this.reservation && !this.control.config.busy && !this.control.config.uncertain
      && !this.control.recovery.busy
      && !this.control.work.blocked && !this.control.work.busy
      && !this.view.submitting && !this.references.prepared
      && !this.view.draft && this.view.status === 'running' && this.input.canSubmit;
  }
  get assignmentReserved() { return !!this.reservation; }
  private get idleForClose() { return this.safeIdle(); }
  private get retainedWorkloadSettled() {
    if (!this.control.observationFresh) return false;
    const observation = this.control.snapshot.observation;
    const reference = this.control.recovery.connectedReference;
    if (!observation || !reference || observation.run_mode !== reference.family) return false;
    if (reference.family === 'task-run') return observation.execution.lifecycle_state === 'TASK_SUSPENDED';
    return reference.family === 'issue-run' && observation.issue_run_execution?.status === 'idle'
      && observation.issue_run_execution.issue_run_id === reference.issue_run_id;
  }
  private safeIdle(preserveDraft = false) {
    const control = this.control, snapshot = control.snapshot, observation = snapshot.observation;
    const retained = preserveDraft && this.retainedWorkloadSettled;
    if (this.disposed || this.nativeState !== 'open' || !this.pty || !this.input.canSubmit || this.view.status !== 'running' || !control.observationFresh || !observation
      || this.reservation || this.deliveryUnknown || this.view.submitting || !preserveDraft && this.view.draft
      || control.pending || control.config.busy || control.config.uncertain || control.work.busy
      || control.work.blocked && !(retained && control.work.activity === 'attention')
      || !this.references.capable || this.references.prepared) return false;
    if (control.config.plan || Object.entries(control.config.draft).some(([key, value]) =>
      !same(value, control.config.actual?.current[key as keyof typeof control.config.actual.current]))) return false;
    const { execution, attention } = observation;
    return (execution.lifecycle_state === 'INTERACTIVE_READY' || retained) && execution.owned_execution_alive === false
      && (retained || execution.workflow_kind === '') && attention.foreground_interaction_active === false
      && attention.restart_confirmation_required === false && attention.termination_confirmation_active === false
      && attention.account_setup_required === false
      && (retained || attention.awaiting_user_command_reason === ''
        && attention.suspension_status === 'inactive' && attention.suspension_reason === '')
      && !snapshot.results.some(result => ['sending', 'queued', 'pending-interaction', 'outcome-unknown'].includes(result.state))
      && (retained || commandNamed(snapshot, '/target')?.enabled === true && commandNamed(snapshot, '/files')?.enabled === true);
  }
  get tabView(): RunnerView {
    let activity: NonNullable<RunnerView['activity']> = this.control.work.presentedActivity;
    if (['completed', 'failed', 'interrupted'].includes(activity)) activity = 'idle';
    const observation = this.control.snapshot.observation;
    if (this.terminationIssue || this.view.status === 'failed' || this.view.status === 'exited'
      && (!!this.view.detail || typeof this.view.exitCode === 'number' && this.view.exitCode !== 0)) activity = 'failed';
    else if (this.view.status === 'exited') activity = 'unknown';
    else if (this.view.status === 'starting' || this.control.snapshot.state === 'connecting'
      || this.control.recovery.busy) activity = 'starting';
    else if (!this.control.observationFresh || !observation) activity = 'unknown';
    if (this.view.status === 'running' && !this.control.recovery.busy && this.control.observationFresh && observation) {
      if (observation.attention.foreground_interaction_active || observation.attention.suspension_status !== 'inactive'
        || observation.attention.restart_confirmation_required || observation.attention.termination_confirmation_active
        || observation.attention.account_setup_required || observation.attention.awaiting_user_command_reason) activity = 'attention';
      else if (observation.execution.owned_execution_alive === true) activity = 'running';
    }
    if (activity === 'idle') {
      if (this.control.observationFresh && observation) {
        const { execution, attention } = observation;
        activity = attention.foreground_interaction_active || attention.suspension_status !== 'inactive'
          || attention.restart_confirmation_required || attention.termination_confirmation_active
          || attention.account_setup_required || attention.awaiting_user_command_reason ? 'attention'
            : execution.owned_execution_alive === true ? 'running'
              : execution.lifecycle_state === 'INTERACTIVE_READY' && execution.workflow_kind === ''
                && execution.owned_execution_alive === false ? 'idle' : 'unknown';
      } else activity = 'unknown';
    }
    if (this.view.status === 'running' && !this.control.recovery.busy && this.control.snapshot.state === 'ready'
      && this.control.observationFresh && observation && (observation.run_mode === 'issue-run'
        || this.control.work.presentedCurrent?.work?.run_mode === 'issue-run')) {
      activity = issueSidebarActivity(this.control.work.presentedCurrent, observation);
    }
    const issueUserActionRequired = activity === 'attention' && this.view.status === 'running'
      && this.control.observationFresh && !!observation && observation.run_mode === 'issue-run'
      && !observation.attention.restart_confirmation_required && !observation.attention.termination_confirmation_active
      && !observation.attention.account_setup_required
      && issueUserAction(this.control.work.presentedCurrent, observation) === 'required';
    return { ...this.view, activity, issueUserActionRequired, unreadCompletion: this.control.work.unread };
  }
  reserve(token: symbol) {
    if (this.disposed || this.view.closing || this.reservation || this.control.config.busy || this.control.config.uncertain
      || this.control.recovery.busy
      || this.control.work.blocked || this.control.work.busy
      || this.view.submitting || this.view.draft || this.references.prepared) return false;
    this.reservation = token;
    this.control.assignmentLocked = true;
    this.changed();
    return true;
  }
  release(token: symbol) {
    if (this.reservation !== token) return;
    this.reservation = undefined;
    this.control.assignmentLocked = false;
    this.changed();
  }
  async deliver(token: symbol, text: string) {
    if (this.reservation !== token || this.disposed || this.view.closing
      || this.view.status !== 'running' || !this.pty || !this.input.canSubmit) {
      throw new HubError(msg('runtime.session.ownershipChanged'));
    }
    this.update({ submitting: true });
    try {
      this.control.assignmentLocked = false;
      const attempt = await this.control.command(text);
      return { attempt, detail: attempt.admission.state === 'submitted' ? msg('interaction.commandSubmitted')
        : attempt.admission.state === 'not-sent' ? msg('runtime.entry.unsent', { reason: attempt.admission.detail })
        : msg('runtime.session.deliveryFailure', { diagnostic: attempt.admission.detail }) };
    } catch (reason) {
      return { detail: msg('runtime.entry.unsent', { reason: errorText(reason) }) };
    } finally {
      this.control.assignmentLocked = !!this.reservation;
      this.update({ submitting: false });
    }
  }
  ownsAssignment(token: symbol, attachmentLease?: symbol) {
    return this.reservation === token && !this.disposed && !this.view.closing && !this.view.draft
      && !this.view.submitting && (!this.references.prepared || this.control.ownsAttachments(attachmentLease)) && this.view.status === 'running'
      && this.input.canSubmit && !this.control.config.uncertain && !this.control.work.blocked;
  }
  private queue(bytes: Uint8Array) {
    if (this.disposed || this.view.closing || this.view.status === 'exited' || this.view.status === 'failed') return;
    if (!this.pty) { this.pending.push(bytes); return; }
    void this.pty.write(bytes).catch(reason => this.error(reason));
  }
  open(location: string) {
    if (this.disposed || this.view.closing) return Promise.resolve();
    return this.opening ??= this.launch(location);
  }
  private async launch(location: string) {
    this.nativeState = 'opening';
    try {
      const request = { runnerLocation: location, cols: this.terminal.cols, rows: this.terminal.rows };
      const pty = await openPty(request, (bytes, consumed) => {
        if (this.disposed) consumed(); else this.terminal.write(bytes, consumed);
      }, event => {
        if (this.pty && event.id !== this.pty.id) return;
        this.nativeState = event.settled ? 'settled' : 'failed';
        this.nativeFailure = event.terminationError;
        this.pending = [];
        if (this.disposed) return;
        this.terminationIssue = event.settled ? undefined : this.terminationDiagnostic();
        const closing = this.view.closing || this.control.tabClosing;
        const unexpected = !closing && event.code !== 0;
        const final = (event as typeof event & { control?: ControlSnapshot }).control;
        this.control.stop(msg('runtime.control.processExited'), final);
        this.unexpectedExit = unexpected && this.nativeSettled && this.connected
          && !!this.control.recovery.saved?.reference
          && this.control.recovery.saved?.state === 'eligible';
        if (this.tabRecord) this.tabRecord = { ...this.tabRecord,
          launchOnOpen: closing ? this.tabRecord.launchOnOpen : unexpected && !!this.control.recovery.saved };
        this.references.dispose();
        const detail = event.code === 0 && !event.error ? undefined : msg('lifecycle.exit', {
          code: event.code ?? msg('lifecycle.exitUnknown'), diagnostic: event.error ?? '',
        });
        this.update({ status: 'exited', exitCode: event.code, detail });
      }, reason => this.error(reason));
      this.pty = pty;
      if (this.exitObserved) return;
      this.nativeState = 'open';
      if (this.disposed || this.view.closing) { this.pending = []; return; }
      this.update({ status: 'running' });
      this.control.start(pty.id);
      for (const bytes of this.pending.splice(0)) await pty.write(bytes);
      await pty.resize(this.terminal.cols, this.terminal.rows);
    } catch (reason) {
      if (this.pty) {
        if (!this.disposed && !this.exitObserved && !this.view.closing)
          this.update({ detail: msg('lifecycle.initialization', { location, diagnostic: errorText(reason) }) });
        return;
      }
      const failure = launchFailure(location, reason);
      this.nativeState = failure.notCreated ? 'not-created' : 'unknown';
      this.pending = [];
      if (this.disposed) return;
      this.control.stop(msg('runtime.control.launchFailed'));
      this.update({ status: 'failed', detail: failure.detail });
    }
  }
  promote(tab: RunnerTabRecord, changed: () => void) {
    if (this.disposed || this.tabRecord) throw new HubError(msg('spare.unavailable', { reason: msg('spare.changed') }));
    this.instructionHistory.reset();
    if (this.presentationRetired) {
      this.control.work.beginPresentation();
      this.control.config.beginPresentation();
      this.control.images.beginPresentation();
    }
    this.tabRecord = tab;
    this.changed = changed;
    this.control.recovery.restore(undefined, false);
    this.captureVerified();
    this.update({ id: tab.id, name: tab.name, createdOrder: tab.createdOrder, detail: undefined });
  }
  rename(name: string) { this.tabRecord = { ...this.tab, name }; this.update({ name }); }
  setDraft(draft: string) {
    if (!this.view.submitting && !this.view.closing) {
      if (this.view.draft !== draft) this.draftRevision++;
      this.composerCompact = false;
      this.update({ draft });
    }
  }
  private clearDraft() {
    this.draftRevision++;
    this.instructionHistory.reset();
    this.view = { ...this.view, draft: '' };
  }
  private observeSubmission() {
    const run = this.submittedRun, settlement = this.control.typedRun.settlement;
    if (run && settlement) {
      this.submittedRun = undefined;
      if (run.tabId === this.view.id && !this.view.closing) {
        if (settlement.state === 'accepted') {
          this.deliveredRunTab = run.tabId;
          if (this.draftRevision === run.revision && this.view.draft === run.draft) this.clearDraft();
          this.view = { ...this.view, detail: msg('interaction.runDelivered') };
        } else this.view = { ...this.view, detail: settlement.detail };
      }
    }
    const command = this.submittedCommand;
    if (command && command.attempt.state === 'completed') {
      if (command.attempt.result?.state === 'accepted' && this.view.draft === command.draft)
        this.clearDraft();
      if (command.attempt.result?.state !== 'accepted') this.view = { ...this.view,
        detail: msg('work.rejected', { code: command.attempt.result?.code || '' }) };
      this.submittedCommand = undefined;
    }
    const submitted = this.submittedAttempt;
    if (!submitted || !this.deliveryUnknown) return;
    const attempt = submitted.attempt;
    if (!attempt.uncertain && (attempt.notSent || attempt.work?.admission === 'rejected' && !attempt.work.started_event_id)) {
      this.deliveryUnknown = false;
      this.references.finishSubmission(false);
      this.submittedAttempt = undefined;
    } else if (this.control.work.hasConfirmedStart(attempt)) {
      this.deliveryUnknown = false;
      if (this.view.draft === submitted.draft) this.clearDraft();
      this.references.finishSubmission(true);
      this.submittedAttempt = undefined;
    }
  }
  private retainSubmission(attempt: WorkAttempt, draft: string) {
    if (this.control.work.hasConfirmedStart(attempt)) {
      if (this.view.draft === draft) {
        this.clearDraft();
        this.changed();
      }
      this.references.finishSubmission(true);
    } else if (!attempt.uncertain && (attempt.notSent || attempt.work?.admission === 'rejected')) {
      this.references.finishSubmission(false);
      throw new HubError(msg('work.rejected', { code: attempt.work?.code || attempt.submission?.code || '' }));
    } else {
      this.submittedAttempt = { attempt, draft };
      this.deliveryUnknown = true;
      throw new HubError(msg('runtime.session.deliveryUnknown'));
    }
  }
  private async submitInstruction(draft: string, defaults: EntryDefaults, briefRun = false) {
    if (this.hubSelections?.loadingOptions) throw new HubError(msg('config.notReady'));
    const ready = () => {
      if (this.disposed || this.view.closing || this.view.status !== 'running' || this.reservation)
        throw new HubError(msg('runtime.session.ownershipChanged'));
      const reason = idleReason(this, true);
      if (reason) throw new HubError(msg('runtime.entry.unsent', { reason }));
    };
    ready();
    const previous = this.control.work.current;
    this.control.assignmentLocked = true;
    try {
      const result = await submitConfiguredWork<WorkAttempt | BriefResult>(this.control.config, this.control.work, defaults, draft, async () => {
        this.control.assignmentLocked = false;
        await this.control.fresh(true); ready();
        await this.references.preflight();
        await this.control.fresh(true); ready();
        this.references.assertReadyForDelivery();
        return this.references.deliveryLease;
      }, briefRun ? lease => this.control.brief.submit(draft, lease) : undefined);
      if ('brief' in result) {
        if (result.status === 'completed') {
          if (this.view.draft === draft) {
            this.clearDraft();
            this.changed();
          }
          this.references.finishSubmission(true);
        }
        else if (result.staged || result.status === 'unknown') this.deliveryUnknown = true;
        else this.references.finishSubmission(false);
      }
    } finally {
      this.control.assignmentLocked = false;
      const attempt = this.control.work.current;
      if (attempt && attempt !== previous) this.retainSubmission(attempt, draft);
    }
  }
  async submit(briefRun = false) {
    try {
    if (this.view.closing) throw new HubError(msg('tabs.closing'));
    if (this.control.recovery.busy) throw new HubError(msg('runtime.control.finishPending'));
    if (this.view.status !== 'running' || !this.pty) throw new HubError(msg('runtime.session.notRunning'));
    if (this.view.submitting || this.control.typedRun.pending) throw new HubError(msg('runtime.session.submissionPending'));
    if (this.reservation) throw new HubError(msg('runtime.session.entryReserved'));
    if (this.foregroundInteraction) throw new HubError(msg('interaction.foregroundBlocked'));
    if (this.submissionUncertain) throw new HubError(msg('runtime.session.previousUnknown'));
    if (briefRun && (this.hubSelections?.defaults.runMode !== 'issue-run' || this.foregroundInteraction)) return;
    const draft = this.view.draft ?? '';
    const ordinary = briefRun || !isRunnerCommand(draft);
    if (!draft.trim()) return;
    if ((!ordinary || this.foregroundInteraction) && this.references.candidates.some(item =>
      !item.submitted && !['cancelled', 'removed'].includes(this.references.state(item))))
      throw new HubError(msg('attachments.instructionOnly'));
    if (!ordinary && this.control.snapshot.observation?.run_mode === 'issue-run') {
      const text = typedRunArguments(draft);
      if (text !== undefined) {
        this.composerCompact = true;
        this.submittedRun = { tabId: this.view.id, draft, revision: this.draftRevision };
        try {
          const admission = this.control.runTyped(draft, text);
          if (this.control.typedRun.pending) this.update({ detail: msg('brief.runRequesting') });
          await admission;
        } catch (reason) {
          this.submittedRun = undefined;
          throw reason;
        }
        return;
      }
    }
    const defaults = copy(this.hubSelections?.defaults ?? {});
    if (ordinary && !this.foregroundInteraction) this.references.freeze();
    let delivered = false;
    this.composerCompact = true;
    this.update({ submitting: true });
    try {
      if (ordinary) await this.control.fresh(true);
      if (this.foregroundInteraction) throw new HubError(msg('interaction.foregroundBlocked'));
      if (this.reservation) throw new HubError(msg('runtime.session.entryReserved'));
      if (ordinary && !this.foregroundInteraction) {
        await this.submitInstruction(draft, defaults, briefRun);
        return;
      }
      if (this.disposed || this.view.status !== 'running')
        throw new HubError(msg('runtime.session.inputUnavailable'));
      const attempt = await this.control.command(draft);
      this.submittedCommand = { attempt, draft };
      this.update({ detail: attempt.admission.state === 'submitted' ? msg('interaction.commandSubmitted')
        : attempt.admission.state === 'not-sent' ? msg('runtime.entry.unsent', { reason: attempt.admission.detail })
        : msg('runtime.session.deliveryFailure', { diagnostic: attempt.admission.detail }) });
      this.observeSubmission();
    } finally {
      if (ordinary && !this.deliveryUnknown) this.references.finishSubmission(delivered);
      this.update({ submitting: false });
    }
    } catch (reason) {
      this.error(reason);
      throw reason;
    }
  }
  closeTab() {
    return this.closing ??= Promise.resolve().then(() => this.settleClose())
      .finally(() => { this.closing = undefined; });
  }
  private terminationDiagnostic(reason?: unknown) {
    const diagnostic = reason ? errorText(reason) : this.nativeFailure;
    const code = reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : '';
    if (this.nativeFailure || code === 'termination-failed')
      return msg('lifecycle.terminationFailed', { code: code || 'termination-failed', diagnostic });
    return diagnostic ? msg('lifecycle.terminationUnknownDetail', { code, diagnostic }) : msg('lifecycle.terminationUnknown');
  }
  private async settleClose() {
    if (!this.disposed) {
      this.control.tabClosing = true;
      this.update({ closing: true });
    }
    try {
      await this.opening;
      if (!this.nativeSettled) {
        if (!this.pty) { this.terminationIssue = this.terminationDiagnostic(); return false; }
        if (!this.exitObserved) this.nativeState = 'closing';
        if (await this.pty.close()) this.nativeState = 'settled';
        const deadline = performance.now() + 10000;
        while (!this.exitObserved && performance.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 50));
        if (!this.nativeSettled) {
          this.terminationIssue = this.terminationDiagnostic();
          return false;
        }
      }
      this.terminationIssue = undefined;
      return true;
    } catch (reason) {
      if (this.nativeSettled) return true;
      this.terminationIssue = this.pty ? this.terminationDiagnostic(reason) : this.terminationDiagnostic();
      return false;
    }
    finally { if (!this.disposed) this.update({ closing: true }); }
  }
  closeFailure(reason: unknown) { this.update({ detail: errorText(reason) }); }
  attach(container: HTMLElement) {
    if (this.terminal.element) container.appendChild(this.terminal.element);
    else this.terminal.open(container);
    this.syncTerminalInput();
    this.syncTerminalBackground();
    const fit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) this.fit.fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    fit();
    return () => observer.disconnect();
  }
  setTheme(theme: TerminalTheme) {
    this.terminal.options.theme = terminalPalettes[theme];
    this.syncTerminalBackground();
  }
  private syncTerminalBackground() {
    this.terminal.element?.style.setProperty('background-color', this.terminal.options.theme!.background!);
  }
  dispose(leaveNativeCleanup = false) {
    if (this.disposed) return this.cleanup ?? Promise.resolve();
    const closing = leaveNativeCleanup ? undefined : this.closeTab();
    this.disposed = true;
    this.control.recovery.discard();
    this.control.stop(msg('runtime.control.workspaceClosed'));
    this.references.dispose();
    clearTimeout(this.resizeTimer);
    this.pending = [];
    this.input.dispose();
    this.terminal.dispose();
    this.cleanup = Promise.resolve(closing).then(settled => {
      if (settled === false && !this.nativeSettled) throw new HubError(this.terminationIssue || this.terminationDiagnostic());
    });
    return this.cleanup;
  }
}

export type RunnerLifecycleEvent = { operation: SpareEvent['operation'] | 'spare-promoted' | 'runner-restarted' | 'runner-shutdown' | 'runner-restart-failed'; runner?: string; detail?: import('./i18n').HubText };
export class RunnerSessions {
  private readonly lifecycleListeners = new Set<(event: RunnerLifecycleEvent) => void>();
  readonly subscribeLifecycle = (listener: (event: RunnerLifecycleEvent) => void) => {
    this.lifecycleListeners.add(listener);
    return () => { this.lifecycleListeners.delete(listener); };
  };
  private lifecycle(event: RunnerLifecycleEvent) { this.lifecycleListeners.forEach(listener => listener(event)); }
  readonly navigation = new RunnerNavigation(() => this.changed());
  private readonly sessions = new Map<string, RunnerSession>();
  private readonly retired = new Map<string, { session: RunnerSession; root: string;
    state: 'checking' | 'idle' | 'restart-pending' | 'restarting' | 'restart-failed' | 'terminating' | 'retrying' | 'failed' }>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly RunnerView[] = [];
  private order = 0;
  private restored = false;
  private readonly interrupted = new WeakSet<RunnerSession>();
  private disposed = false;
  private disposal?: Promise<void[]>;
  readonly workspace = new RunnerWorkspace();
  readonly restarts = new RunnerRestarts(() => this.changed());
  private consumers = 0;
  private terminalTheme: TerminalTheme = 'light';
  private readonly spare = new RunnerSpare(
    (installationRoot, changed) => {
      const session = new RunnerSession({ installationRoot }, () => {
        this.navigation.observe(undefined, session.control.work);
        changed();
      });
      return session;
    }, () => this.changed(),
    (session, root) => this.retainRestartFailure(session, root), event => this.lifecycle(event));
  get spareSnapshot() { return this.spare.snapshot; }
  setTerminalTheme(theme: TerminalTheme) {
    if (this.terminalTheme === theme) return;
    this.terminalTheme = theme;
    for (const session of this.sessions.values()) session.setTheme(theme);
    for (const { session } of this.retired.values()) session.setTheme(theme);
  }
  setInstallation(installation: RunnerInstallation | null) {
    if (this.disposed) return;
    if (installation) this.restore();
    this.spare.setInstallation(installation);
  }
  readonly entry: SingleEntry;
  private readonly selections = new Map<string, HubSelections>();
  private readonly savedSelections: Record<string, EntryDefaults>;
  constructor(defaults: EntryDefaults = {}, saveDefaults: (value: EntryDefaults) => void = () => {},
    savedSelections: Record<string, EntryDefaults> = {},
    private readonly saveSelections: (id: string, value: EntryDefaults) => void = () => {},
    private readonly forgetSelection: (id: string) => void = () => {}) {
    this.savedSelections = { ...savedSelections };
    this.entry = new SingleEntry(() => [...this.sessions.values()],
      (location, token, provider) => this.allocate(location, token, undefined, provider), () => this.changed(), defaults, saveDefaults,
      () => this.spare.optionsSource ?? [...this.sessions.values()].find(s => s.assignmentAvailable),
      id => this.navigation.snapshot.affinities[id]);
  }
  getSelections(id?: string) { return id ? this.selections.get(id) : undefined; }
  private bindSelections(session: RunnerSession, retained?: EntryDefaults, initialMode?: RunMode) {
    const id = session.view.id, saved = this.savedSelections[id];
    const defaults = retained ?? saved ?? this.entry.defaults;
    const selections = new HubSelections(() => session.control.snapshot.state === 'ready'
      && !session.control.assignmentLocked && !session.control.recovery.busy ? session.control.config : undefined,
    this.changed, defaults, value => {
      if (this.sessions.get(id) !== session) return;
      session.control.config.setDraft({});
      this.saveSelections(id, value);
    }, () => this.sessions.get(id) === session && session.view.status === 'running'
      && !session.control.recovery.busy && !session.control.assignmentLocked && !session.view.closing
      && !session.view.submitting && !session.submissionUncertain,
    () => session.control.observationFresh ? session.control.snapshot.observation : undefined, initialMode,
    mode => this.navigation.setRequestedMode(id, session.control.work, mode));
    this.selections.set(id, selections);
    session.hubSelections = selections;
    if (initialMode) this.navigation.setRequestedMode(id, session.control.work, initialMode);
    if (!saved && selections.initialized) this.saveSelections(id, selections.defaults);
  }
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private readonly changed = () => {
    if (this.disposed) return;
    for (const [id, item] of this.retired) {
      if (item.state === 'idle' && !item.session.reusableIdle) void this.terminateRemoved(id);
      if (item.state === 'failed' && item.session.terminationSettled) {
        this.retired.delete(id);
        void item.session.dispose();
      }
    }
    this.entry?.observe();
    this.restarts.observe();
    if (this.spare.snapshot.installation) {
      this.entry?.selections.initialize();
      this.selections.forEach(selections => selections.initialize());
    }
    for (const [id, session] of this.sessions) this.navigation.observe(id, session.control.work,
      this.selections.get(id)?.defaults.runMode ?? session.tab.lastVerified?.runMode);
    for (const [id, session] of this.sessions) {
      if (!session.unexpectedExit || this.interrupted.has(session)) continue;
      this.interrupted.add(session);
      queueMicrotask(() => {
        if (!this.disposed && this.sessions.get(id) === session && !session.view.closing)
          void this.replaceForRestart(id, session, false, true).catch(reason => session.closeFailure(reason));
      });
    }
    for (const item of this.retired.values()) this.navigation.observe(undefined, item.session.control.work);
    const saved = !this.restored || this.workspace.save([...this.sessions.values()].map(session => session.tab), this.navigation.snapshot);
    this.publish();
    return saved;
  };
  private publish() {
    this.snapshot = [...this.sessions.values()].map(session => session.tabView);
    this.listeners.forEach(listener => listener());
  }
  get(id?: string) { return id ? this.sessions.get(id) : undefined; }
  canDropRunner(id: string, source: RunnerDrop['source']['domain'], destination: RunnerDrop['destination']['domain']) {
    return source === destination || (destination !== 'runner' && this.getSelections(id)?.canSetTabMode(destination) === true);
  }
  dropRunner(fixtures: readonly RunnerView[], display: DomainDisplay, drop: RunnerDrop) {
    const runners = [...fixtures, ...this.snapshot];
    const { id, source, destination } = drop;
    if (source.domain === destination.domain) {
      this.navigation.reorder(runners, display, drop);
      return;
    }
    if (display !== 'run-mode' || destination.domain === 'runner') return;
    const commitOrder = this.navigation.prepareDropOrder(runners, display, drop);
    if (commitOrder) this.getSelections(id)?.setTabMode(destination.domain, commitOrder);
  }
  restartAll() {
    if (this.disposed || this.restarts.pending) return false;
    const targets = [...this.sessions].map(([id, session]) => this.restartTarget(id, session));
    for (const [id, item] of this.retired) {
      if (item.state === 'idle' || item.state === 'restarting') {
        targets.push(this.restartTarget(id, item.session, true));
        item.state = 'restart-pending';
      }
    }
    const spare = this.spare.restartTarget();
    if (spare) targets.push(spare);
    return this.restarts.request(targets);
  }
  private retainRestartFailure(session: RunnerSession, root: string) {
    if (this.disposed) { void session.dispose(true); return; }
    session.setTheme(this.terminalTheme);
    this.retired.set(crypto.randomUUID(), { session, root, state: 'restart-failed' });
    this.changed();
  }
  private restartTarget(id: string, session: RunnerSession, hidden = false): RestartTarget {
    const owns = () => !this.disposed && (hidden ? this.retired.get(id)?.session : this.sessions.get(id)) === session;
    const unavailable = () => ['failed', 'exited'].includes(session.view.status)
      || session.control.snapshot.state === 'disconnected';
    return { name: session.view.name || 'Runner',
      ready: () => !owns() || session.restartReady || unavailable(),
      revalidation: () => ({ ...session.restartObservation,
        key: JSON.stringify([owns(), session.restartObservation.key]) }),
      restart: async () => {
        if (!owns()) return 'removed';
        if (unavailable()) throw new HubError(msg('restart.unavailable'));
        try { if (!await session.verifyRestart() || !session.restartReady) return 'pending'; }
        catch { return 'pending'; }
        if (!hidden) await session.control.recovery.refreshConnected();
        if (!owns()) return 'removed';
        if (!session.restartReady || session.control.recovery.code === 'RECOVERY_SAVE_FAILED') return 'pending';
        return this.replaceForRestart(id, session, hidden);
      } };
  }
  getFailure(id?: string) { return id && ['failed', 'restart-failed', 'retrying'].includes(this.retired.get(id)?.state ?? '') ? this.retired.get(id)?.session : undefined; }
  get failures() { return [...this.retired.entries()].filter(([id]) => this.getFailure(id))
    .map(([id, item]) => ({ ...item.session.view, id, name: item.session.view.name || 'Runner' })); }
  retryFailure(id: string) {
    if (!this.disposed && this.getFailure(id)?.canRetryTermination) void this.terminateRemoved(id, true);
  }
  dismissFailure(id: string) {
    const session = this.getFailure(id);
    if (this.disposed || !session) return;
    this.retired.delete(id);
    // A retained native session is still owned by the window registry.
    void session.dispose(true);
    this.changed();
  }
  view(id: string | null) {
    for (const session of this.sessions.values()) session.control.work.setViewed(session.view.id === id);
  }
  private waitForReplacement(session: RunnerSession, owns: () => boolean, restore: boolean) {
    return new Promise<RestartOutcome>((resolve, reject) => {
      const check = () => {
        if (!owns()) { unsubscribe(); resolve('removed'); return; }
        if (session.view.detail || ['failed', 'exited'].includes(session.view.status)
          || session.control.snapshot.state === 'disconnected') {
          unsubscribe(); reject(new HubError(session.view.detail || session.control.snapshot.detail || msg('restart.launchFailed')));
          return;
        }
        const { busy, outcome } = session.control.recovery;
        if (!restore || !outcome) {
          if (session.restartReady) { unsubscribe(); resolve('restarted'); }
          return;
        }
        if (busy || session.view.status !== 'running' || !session.control.observationFresh) return;
        if (outcome === 'recovered' || outcome === 'mode-restored') {
          if (!session.view.canSubmit) return;
          unsubscribe();
          resolve(outcome === 'recovered' ? 'context-restored' : outcome);
        } else {
          const detail = session.recoveryDiagnostic;
          if (!detail) return;
          const uncertain = outcome === 'partial' || outcome === 'unverified';
          unsubscribe();
          resolve({ state: uncertain ? 'restoration-uncertain' : 'restoration-failed', detail: msg(
            uncertain ? 'restart.restorationUncertain' : 'restart.restorationFailed', { detail },
          ) });
        }
      };
      const unsubscribe = this.subscribe(check);
      check();
    });
  }
  private async replaceForRestart(id: string, session: RunnerSession, hidden: boolean, interrupted = false): Promise<RestartOutcome> {
    const root = hidden ? this.retired.get(id)!.root : session.tab.installationRoot;
    const owns = () => !this.disposed && (hidden ? this.retired.get(id)?.session : this.sessions.get(id)) === session;
    const tab = hidden ? { installationRoot: root } : { ...session.tab, launchOnOpen: true };
    const defaults = hidden ? undefined : copy(this.selections.get(id)?.defaults ?? {});
    if (hidden) this.retired.get(id)!.state = 'checking';
    if (!await session.closeTab()) {
      if (!owns()) return 'removed';
      if (hidden) { this.retired.get(id)!.state = 'failed'; this.changed(); }
      this.lifecycle({ operation: 'runner-restart-failed', runner: session.view.name, detail: msg('restart.cleanupFailed') });
      throw new HubError(msg('restart.cleanupFailed'));
    }
    if (!owns()) return 'removed';
    const replacement = new RunnerSession(tab, this.changed, !hidden);
    replacement.setTheme(this.terminalTheme);
    replacement.setDraft(session.view.draft ?? '');
    if (hidden) {
      this.retired.set(id, { session: replacement, root, state: 'restarting' });
      replacement.retireTab(); replacement.hide();
    }
    else { this.sessions.set(id, replacement); this.bindSelections(replacement, defaults); }
    this.changed();
    const replacementOwned = () => !this.disposed
      && (hidden ? this.retired.get(id)?.session : this.sessions.get(id)) === replacement;
    let outcome: RestartOutcome = 'restarted';
    try {
      await replacement.open(root);
      if (!interrupted) outcome = await this.waitForReplacement(replacement, replacementOwned, 'recovery' in tab && !!tab.recovery);
    } catch (reason) {
      if (!replacementOwned()) { await session.dispose(); return 'removed'; }
      this.retainRestartFailure(session, root);
      this.lifecycle({ operation: 'runner-restart-failed', runner: session.view.name, detail: errorText(reason) });
      replacement.closeFailure(reason);
      if (hidden && replacementOwned()) this.retired.get(id)!.state = 'restart-failed';
      throw reason;
    }
    if (!replacementOwned()) {
      await session.dispose();
      return 'removed';
    }
    if (hidden) this.retired.get(id)!.state = 'idle';
    await session.dispose();
    if (!replacementOwned()) return 'removed';
    if (typeof outcome === 'object')
      this.lifecycle({ operation: 'runner-restart-failed', runner: replacement.view.name, detail: outcome.detail });
    else this.lifecycle({ operation: 'runner-restarted', runner: replacement.view.name });
    return outcome;
  }
  close(id: string) {
    const session = this.sessions.get(id);
    if (!session || this.disposed) return false;
    const remaining = [...this.sessions.values()].filter(candidate => candidate !== session);
    if (!this.workspace.save(remaining.map(candidate => candidate.tab))) {
      this.publish();
      return false;
    }
    const terminate = session.control.recovery.busy || !!session.control.recovery.saved?.reference;
    this.retired.set(id, { session, root: session.tab.installationRoot, state: 'checking' });
    this.sessions.delete(id);
    this.selections.delete(id);
    delete this.savedSelections[id];
    this.forgetSelection(id);
    this.navigation.forget(id, session.control.work);
    session.retireTab();
    this.changed();
    if (terminate) void this.terminateRemoved(id);
    else void this.settleRemoved(id);
    return true;
  }
  private async settleRemoved(id: string) {
    const item = this.retired.get(id);
    if (!item) return;
    let reusable = false;
    try { reusable = await item.session.verifyReusable(); } catch { /* Terminate uncertain sessions. */ }
    if (this.disposed || this.retired.get(id) !== item) return;
    if (reusable) {
      item.state = 'idle';
      item.session.hide();
    } else await this.terminateRemoved(id);
  }
  private async terminateRemoved(id: string, retry = false) {
    const item = this.retired.get(id);
    if (!item || item.state === 'terminating' || item.state === 'retrying') return;
    item.state = retry ? 'retrying' : 'terminating';
    item.session.retireTab();
    const settled = await item.session.closeTab();
    if (this.disposed || this.retired.get(id) !== item) return;
    if (settled) {
      this.lifecycle({ operation: 'runner-shutdown', runner: item.session.view.name });
      await item.session.dispose();
      if (this.retired.get(id) === item) this.retired.delete(id);
    } else item.state = 'failed';
    this.changed();
  }
  retain() {
    this.consumers++;
    return () => {
      this.consumers--;
      queueMicrotask(() => {
        if (!this.consumers) void this.dispose().catch(reason => console.error('Runner cleanup failed', reason));
      });
    };
  }
  private restore() {
    if (this.restored) return;
    this.restored = true;
    const tabs = this.workspace.load();
    if (!this.workspace.issue) {
      const ids = new Set(tabs.map(tab => tab.id));
      for (const id of Object.keys(this.savedSelections)) {
        if (ids.has(id)) continue;
        delete this.savedSelections[id];
        this.forgetSelection(id);
      }
    }
    this.navigation.restore(this.workspace.presentation);
    for (const tab of tabs) {
      const session = new RunnerSession(tab, this.changed, true);
      session.setTheme(this.terminalTheme);
      this.sessions.set(tab.id, session);
      this.bindSelections(session);
      this.order = Math.max(this.order, tab.createdOrder);
    }
    this.changed();
    for (const tab of tabs) {
      if (tab.launchOnOpen) void this.sessions.get(tab.id)?.open(tab.installationRoot);
    }
  }
  create(location: string, token?: symbol, initialMode?: RunMode) {
    if (this.disposed) throw new HubError(msg('spare.closed'));
    this.restore();
    const order = ++this.order;
    const session = new RunnerSession({ id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
      installationRoot: location, launchOnOpen: true }, this.changed);
    session.setTheme(this.terminalTheme);
    this.sessions.set(session.view.id, session);
    this.bindSelections(session, undefined, initialMode);
    if (token && !session.reserve(token)) throw new HubError(msg('runtime.session.reservationFailed'));
    this.changed();
    return { session, launched: session.open(location) };
  }
  allocate(location: string, token?: symbol, initialMode?: RunMode, provider?: string) {
    if (this.disposed) throw new HubError(msg('spare.closed'));
    for (const [id, item] of this.retired) {
      if (item.state !== 'idle' || item.root !== location || !item.session.reusableIdle) continue;
      const session = item.session;
      if (provider && session.control.config.observedAgentId !== provider) continue;
      item.state = 'checking';
      if (token && !session.reserve(token)) { item.state = 'idle'; continue; }
      this.retired.delete(id);
      session.terminal.clear();
      session.terminal.write('\x1b[2J\x1b[3J\x1b[H');
      const order = ++this.order;
      session.promote({ id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
        installationRoot: location, launchOnOpen: true }, this.changed);
      this.sessions.set(session.view.id, session);
      this.bindSelections(session, undefined, initialMode);
      this.changed();
      return { session, launched: Promise.resolve() };
    }
    if (this.spare.snapshot.state === 'ready' && this.spare.snapshot.installation?.root === location
      && (!provider || this.spare.optionsSource?.control.config.observedAgentId === provider)) {
      const session = this.promoteSpare(token, initialMode);
      return { session, launched: Promise.resolve(), promoted: true };
    }
    return this.create(location, token, initialMode);
  }
  promoteSpare(token?: symbol, initialMode?: RunMode) {
    if (this.disposed) throw new HubError(msg('spare.closed'));
    const installationRoot = this.spare.snapshot.installation?.root;
    if (!installationRoot) throw new HubError(msg('spare.verify'));
    const session = this.spare.take();
    session.setTheme(this.terminalTheme);
    if (token && !session.reserve(token)) throw new HubError(msg('runtime.session.reservationFailed'));
    const order = ++this.order;
    const tab = { id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
      installationRoot, launchOnOpen: true };
    session.promote(tab, this.changed);
    this.sessions.set(tab.id, session);
    this.bindSelections(session, undefined, initialMode);
    this.lifecycle({ operation: 'spare-promoted', runner: tab.name });
    this.changed();
    this.spare.replenish();
    return session;
  }
  intentionalShutdown() {
    if (this.disposed) return;
    for (const session of this.sessions.values()) {
      session.control.tabClosing = true;
      session.control.recovery.close();
    }
    if (this.restored) this.workspace.save([...this.sessions.values()].map(session => session.tab), this.navigation.snapshot);
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.intentionalShutdown();
    this.disposed = true;
    this.listeners.forEach(listener => listener());
    this.restarts.dispose();
    this.entry.attachments.dispose();
    this.disposal = Promise.all([this.spare.dispose(), ...[...this.sessions.values(),
      ...[...this.retired.values()].map(item => item.session)].map(session => session.dispose())]);
    this.sessions.clear();
    this.retired.clear();
    this.selections.clear();
    this.listeners.clear();
    this.lifecycleListeners.clear();
    return this.disposal;
  }
}
