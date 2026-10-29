import { msg, errorText, HubError } from './i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { openPty, type Pty } from '../../.runner/web-app-desktop/terminal/bridge';
import { RunnerInput } from './runnerInput';
import { RunnerControl, commandNamed, isRunnerCommand, type ControlSnapshot, type CommandAttempt } from './runnerControl';
import { RunnerReferenceSelection } from './referenceSelection';
import type { RunnerView } from './model';
import { SingleEntry, idleReason, type EntryDefaults } from './singleEntry';
import { submitConfiguredWork } from './runnerSubmission';
import { RunnerWorkspace, type RunnerTabRecord } from './RunnerWorkspace';
import { RunnerSpare } from './RunnerSpare';
import { RunnerRestarts, type RestartTarget, type RestartOutcome } from './RunnerRestarts';
import type { RunnerInstallation } from './runnerInstallation';
import { copy, same } from './runnerConfigContract';
import type { WorkAttempt } from './runnerWork';
import type { BriefResult } from './RunnerBrief';
import { HubSelections } from './HubSelections';
import '@xterm/xterm/css/xterm.css';

export class RunnerSession {
  readonly terminal = new Terminal({ cursorBlink: false, scrollback: 10000 });
  hubSelections?: HubSelections;
  private submittedAttempt?: { attempt: WorkAttempt; draft: string };
  private submittedCommand?: { attempt: CommandAttempt; draft: string };
  searchQuery = '';
  readonly fit = new FitAddon();
  readonly search = new SearchAddon();
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
  private reservation?: symbol;
  private deliveryUnknown = false;
  private nativeState: 'unverified' | 'open' | 'closing' | 'settled' | 'failed' = 'unverified';
  private nativeFailure?: string;
  private get nativeSettled() { return this.nativeState === 'settled'; }
  get terminationSettled() { return this.nativeSettled; }
  private get exitObserved() { return this.nativeState === 'settled' || this.nativeState === 'failed'; }
  get submissionUncertain() { return this.deliveryUnknown || this.control.commandUnresolved || this.control.brief.blocked; }
  view: RunnerView;
  private tabRecord?: RunnerTabRecord;
  private presentationRetired = false;
  get tab() {
    if (!this.tabRecord) throw new Error('Hidden Runner has no workspace tab');
    return this.tabRecord;
  }
  previousContext: RunnerTabRecord['recoveryHint'];
  get reusableIdle() { return !this.view.closing && this.idleForClose; }
  get restartReady() {
    const activity = this.control.work.activity;
    const inventory = this.control.work.progress;
    return !this.view.closing && activity !== 'attention' && activity !== 'unknown'
      && !(inventory?.operation === 'work.list' && inventory.state === 'outcome-unknown') && this.safeIdle(true);
  }
  get restartObservation() {
    const { snapshot, receivedAt } = this.control;
    return { key: JSON.stringify([this.view.status, this.view.closing,
      snapshot.state, snapshot.observation, this.control.work.activity, this.references.prepared]), observedAt: receivedAt };
  }
  retireTab() {
    this.control.interaction.retire();
    this.control.tabClosing = true;
    this.control.work.suspendDiscovery();
    this.hubSelections = undefined;
    this.update({ closing: true });
  }
  verifyReusable() { return this.verifyIdle(false); }
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
    await this.references.verifyAssignment();
    await this.control.fresh();
    return this.safeIdle(preserveDraft);
  }
  hide() {
    this.presentationRetired = true;
    this.tabRecord = undefined;
    this.previousContext = undefined;
    this.searchQuery = '';
    this.control.tabClosing = false;
    this.update({ closing: false });
  }

  constructor(tab: RunnerTabRecord | Pick<RunnerTabRecord, 'installationRoot'>,
    private changed: () => void, public restored = false) {
    this.tabRecord = 'id' in tab ? tab : undefined;
    if (this.tabRecord?.launchOnOpen === false) this.nativeState = 'settled';
    this.previousContext = this.tabRecord?.recoveryHint;
    // Empty display fields remain private until the workspace assigns a tab at promotion.
    this.view = { id: this.tabRecord?.id ?? '', createdOrder: this.tabRecord?.createdOrder ?? 0,
      name: this.tabRecord?.name ?? '', status: this.tabRecord?.launchOnOpen === false ? 'exited' : 'starting',
      canSubmit: false, draft: '', submitting: false };
    this.control = new RunnerControl(() => {
      if (!this.disposed) { this.captureVerified(); this.observeSubmission(); this.syncTerminalInput(); this.changed(); }
    });
    this.references = new RunnerReferenceSelection(this.control, () => { if (!this.disposed) this.changed(); });
    this.terminal.loadAddon(this.fit);
    this.terminal.loadAddon(this.search);
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
    if (!this.tabRecord || !observation || !this.control.observationFresh) return;
    // Fresh settings do not confirm historical work recovery or retire its retained hint.
    this.tabRecord = { ...this.tabRecord, lastVerified: {
      target: { ...observation.target }, runMode: observation.run_mode,
      workflowKind: observation.execution.workflow_kind,
    } };
  }
  private protocolChanged() {
    if (this.input && this.view.canSubmit !== this.input.canSubmit) this.update({ canSubmit: this.input.canSubmit });
  }
  private error(reason: unknown) { if (!this.disposed) this.update({ detail: errorText(reason) }); }
  get foregroundInteraction() {
    return this.control.interaction.view?.state === 'active' || this.control.interaction.writing
      || this.control.observationFresh && (!!this.control.snapshot.observation?.attention.foreground_interaction_active
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
      && !this.control.work.blocked && !this.control.work.busy
      && !this.view.submitting && !this.references.prepared
      && !this.view.draft && this.view.status === 'running' && this.input.canSubmit;
  }
  get assignmentReserved() { return !!this.reservation; }
  private get idleForClose() { return this.safeIdle(); }
  private safeIdle(preserveDraft = false) {
    const control = this.control, snapshot = control.snapshot, observation = snapshot.observation;
    if (this.disposed || this.nativeState !== 'open' || !this.pty || !this.input.canSubmit || this.view.status !== 'running' || !control.observationFresh || !observation
      || this.reservation || this.deliveryUnknown || this.view.submitting || !preserveDraft && this.view.draft
      || control.pending || control.config.busy || control.config.uncertain || control.work.busy || control.work.blocked
      || !this.references.capable || this.references.prepared) return false;
    if (control.config.plan || Object.entries(control.config.draft).some(([key, value]) =>
      !same(value, control.config.actual?.current[key as keyof typeof control.config.actual.current]))) return false;
    const { execution, attention } = observation;
    return execution.lifecycle_state === 'INTERACTIVE_READY' && execution.owned_execution_alive === false
      && execution.workflow_kind === '' && attention.foreground_interaction_active === false
      && attention.restart_confirmation_required === false && attention.termination_confirmation_active === false
      && attention.account_setup_required === false && attention.awaiting_user_command_reason === ''
      && attention.suspension_status === 'inactive' && attention.suspension_reason === ''
      && !snapshot.results.some(result => ['sending', 'queued', 'pending-interaction', 'outcome-unknown'].includes(result.state))
      && commandNamed(snapshot, '/target')?.enabled === true && commandNamed(snapshot, '/files')?.enabled === true;
  }
  get tabView(): RunnerView {
    let activity = this.control.work.presentedActivity;
    const observation = this.control.snapshot.observation;
    if (activity === 'running' && this.control.observationFresh && observation
      && (observation.attention.foreground_interaction_active || observation.attention.suspension_status !== 'inactive'
        || observation.attention.restart_confirmation_required || observation.attention.termination_confirmation_active
        || observation.attention.account_setup_required || observation.attention.awaiting_user_command_reason)) activity = 'attention';
    if (activity === 'idle') {
      if (this.control.observationFresh && observation) {
        const { execution, attention } = observation;
        activity = attention.foreground_interaction_active || attention.suspension_status !== 'inactive'
          || attention.restart_confirmation_required || attention.termination_confirmation_active
          || attention.account_setup_required || attention.awaiting_user_command_reason ? 'attention'
            : execution.owned_execution_alive === true ? 'running' : this.idleForClose ? 'idle' : 'unknown';
      } else activity = 'unknown';
    }
    return { ...this.view, activity, unreadCompletion: this.control.work.unread };
  }
  reserve(token: symbol) {
    if (this.disposed || this.view.closing || this.reservation || this.control.config.busy || this.control.config.uncertain
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
    if (this.disposed) return Promise.resolve();
    return this.opening ??= this.launch(location);
  }
  private async launch(location: string) {
    try {
      const request = { runnerLocation: location, cols: this.terminal.cols, rows: this.terminal.rows };
      const pty = await openPty(request, (bytes, consumed) => {
        if (this.disposed) consumed(); else this.terminal.write(bytes, consumed);
      }, event => {
        if (this.disposed || this.pty && event.id !== this.pty.id) return;
        this.nativeState = event.error ? 'failed' : 'settled';
        this.nativeFailure = event.error ?? undefined;
        if (this.tabRecord) this.tabRecord = { ...this.tabRecord, launchOnOpen: false };
        const final = (event as typeof event & { control?: ControlSnapshot }).control;
        this.control.stop(msg('runtime.control.processExited'), final);
        this.references.dispose();
        this.update({ status: 'exited', exitCode: event.code, detail: event.error ?? undefined });
      }, reason => this.error(reason));
      this.pty = pty;
      if (this.disposed) { await pty.close(); return; }
      if (this.view.status === 'exited') { this.pending = []; return; }
      this.nativeState = 'open';
      this.update({ status: 'running' });
      this.control.start(pty.id);
      for (const bytes of this.pending.splice(0)) await pty.write(bytes);
      await pty.resize(this.terminal.cols, this.terminal.rows);
    } catch (reason) {
      if (this.disposed) return;
      if (!this.pty) this.control.stop(msg('runtime.control.launchFailed'));
      this.update({ ...(this.pty ? {} : { status: 'failed' }), detail: errorText(reason) });
    }
  }
  promote(tab: RunnerTabRecord, changed: () => void) {
    if (this.disposed || this.tabRecord) throw new HubError(msg('spare.unavailable', { reason: msg('spare.changed') }));
    if (this.presentationRetired) {
      this.control.work.beginPresentation();
      this.control.config.beginPresentation();
      this.control.images.beginPresentation();
    }
    this.tabRecord = tab;
    this.changed = changed;
    this.restored = false;
    this.captureVerified();
    this.update({ id: tab.id, name: tab.name, createdOrder: tab.createdOrder, detail: undefined });
  }
  rename(name: string) { this.tabRecord = { ...this.tab, name }; this.update({ name }); }
  setDraft(draft: string) { if (!this.view.submitting && !this.view.closing) this.update({ draft }); }
  private observeSubmission() {
    const command = this.submittedCommand;
    if (command && command.attempt.state === 'completed') {
      if (command.attempt.result?.state === 'accepted' && this.view.draft === command.draft)
        this.view = { ...this.view, draft: '' };
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
    } else if (attempt.work?.started_event_id) {
      this.deliveryUnknown = false;
      if (this.view.draft === submitted.draft) this.view = { ...this.view, draft: '' };
      this.references.finishSubmission(true);
      this.submittedAttempt = undefined;
    }
  }
  private retainSubmission(attempt: WorkAttempt, draft: string) {
    if (attempt.work?.started_event_id) {
      this.update({ draft: '' });
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
        await this.control.fresh(); ready();
        await this.references.preflight();
        await this.control.fresh(); ready();
        this.references.assertReadyForDelivery();
        return this.references.deliveryLease;
      }, briefRun ? lease => this.control.brief.submit(draft, lease) : undefined);
      if ('brief' in result) {
        if (result.status === 'completed') { this.update({ draft: '' }); this.references.finishSubmission(true); }
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
    if (this.view.closing) throw new HubError(msg('tabs.closing'));
    if (this.view.status !== 'running' || !this.pty) throw new HubError(msg('runtime.session.notRunning'));
    if (this.view.submitting) throw new HubError(msg('runtime.session.submissionPending'));
    if (this.reservation) throw new HubError(msg('runtime.session.entryReserved'));
    if (this.foregroundInteraction) throw new HubError(msg('interaction.usePanel'));
    if (this.submissionUncertain) throw new HubError(msg('runtime.session.previousUnknown'));
    if (briefRun && (this.hubSelections?.defaults.runMode !== 'issue-run' || this.foregroundInteraction)) return;
    const draft = this.view.draft ?? '';
    const ordinary = briefRun || !isRunnerCommand(draft);
    if (!draft.trim()) return;
    if ((!ordinary || this.foregroundInteraction) && this.references.candidates.some(item =>
      !item.submitted && !['cancelled', 'removed'].includes(this.references.state(item))))
      throw new HubError(msg('attachments.instructionOnly'));
    const defaults = copy(this.hubSelections?.defaults ?? {});
    if (ordinary && !this.foregroundInteraction) this.references.freeze();
    let delivered = false;
    this.update({ submitting: true });
    try {
      if (ordinary) await this.control.fresh();
      if (this.foregroundInteraction) throw new HubError(msg('interaction.usePanel'));
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
    } catch (reason) {
      throw reason;
    } finally {
      if (ordinary && !this.deliveryUnknown) this.references.finishSubmission(delivered);
      this.update({ submitting: false });
    }
  }
  closeTab() { return this.closing ??= this.settleClose(); }
  private async settleClose() {
    if (this.disposed) return this.nativeSettled;
    this.control.interaction.close();
    this.control.tabClosing = true;
    this.update({ closing: true });
    try {
      await this.opening;
      if (!this.nativeSettled) {
        if (!this.pty || this.exitObserved) throw new HubError(this.nativeFailure || msg('tabs.unconfirmed'));
        this.nativeState = 'closing';
        await this.pty.close();
        const deadline = performance.now() + 10000;
        while (!this.exitObserved && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (!this.nativeSettled) throw new HubError(this.nativeFailure || msg('tabs.unconfirmed'));
      }
      return true;
    } catch (reason) { this.error(reason); return false; }
    finally { this.update({ closing: true }); }
  }
  closeFailure(reason: unknown) { this.update({ detail: errorText(reason) }); }
  attach(container: HTMLElement, theme: 'light' | 'black') {
    if (this.terminal.element) container.appendChild(this.terminal.element);
    else this.terminal.open(container);
    this.syncTerminalInput();
    this.setTheme(theme);
    const fit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) this.fit.fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    fit();
    return () => observer.disconnect();
  }
  setTheme(theme: 'light' | 'black') {
    this.terminal.options.theme = theme === 'black'
      ? { background: '#111214', foreground: '#eeeeef', cursor: '#eeeeef', selectionBackground: '#38577f' }
      : { background: '#ffffff', foreground: '#23272e', cursor: '#23272e', selectionBackground: '#c4d9f5' };
  }
  dispose() {
    if (this.disposed) return this.cleanup ?? Promise.resolve();
    this.disposed = true;
    this.control.stop(msg('runtime.control.workspaceClosed'));
    this.references.dispose();
    clearTimeout(this.resizeTimer);
    this.pending = [];
    const closing = this.nativeSettled ? undefined : this.pty?.close();
    this.input.dispose();
    this.terminal.dispose();
    this.cleanup = Promise.all([this.opening, closing]).then(async () => { if (!this.nativeSettled) await this.pty?.close(); });
    return this.cleanup;
  }
}

export class RunnerSessions {
  private readonly sessions = new Map<string, RunnerSession>();
  private readonly retired = new Map<string, { session: RunnerSession; root: string;
    state: 'checking' | 'idle' | 'restart-pending' | 'restarting' | 'restart-failed' | 'terminating' | 'failed' }>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly RunnerView[] = [];
  private order = 0;
  private restored = false;
  private disposed = false;
  readonly workspace = new RunnerWorkspace();
  readonly restarts = new RunnerRestarts(() => this.changed());
  private consumers = 0;
  private readonly spare = new RunnerSpare(
    (installationRoot, changed) => new RunnerSession({ installationRoot }, changed), () => this.changed(),
    (session, root) => this.retainRestartFailure(session, root));
  get spareSnapshot() { return this.spare.snapshot; }
  setInstallation(installation: RunnerInstallation | null) {
    if (this.disposed) return;
    if (installation) this.restore();
    this.spare.setInstallation(installation);
  }
  readonly entry: SingleEntry;
  private readonly selections = new Map<string, HubSelections>();
  constructor(defaults: EntryDefaults = {}, saveDefaults: (value: EntryDefaults) => void = () => {},
    private readonly savedSelections: Record<string, EntryDefaults> = {},
    private readonly saveSelections: (id: string, value: EntryDefaults) => void = () => {}) {
    this.entry = new SingleEntry(() => [...this.sessions.values()],
      (location, token) => this.allocate(location, token), () => this.changed(), defaults, saveDefaults,
      () => this.spare.optionsSource ?? [...this.sessions.values()].find(s => s.assignmentAvailable));
  }
  getSelections(id?: string) { return id ? this.selections.get(id) : undefined; }
  private bindSelections(session: RunnerSession, retained?: EntryDefaults) {
    const id = session.view.id, saved = this.savedSelections[id];
    const defaults = retained ?? saved ?? this.entry.defaults;
    const selections = new HubSelections(() => session.control.snapshot.state === 'ready'
      && !session.control.assignmentLocked ? session.control.config : undefined,
    this.changed, defaults, value => {
      if (this.sessions.get(id) !== session) return;
      session.control.config.setDraft({});
      this.saveSelections(id, value);
    }, () => this.sessions.get(id) === session && session.view.status === 'running' && !session.control.assignmentLocked && !session.view.closing
      && !session.view.submitting && !session.submissionUncertain);
    this.selections.set(id, selections);
    session.hubSelections = selections;
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
    if (this.restored) this.workspace.save([...this.sessions.values()].map(session => session.tab));
    this.snapshot = [...this.sessions.values()].map(session => session.tabView);
    this.listeners.forEach(listener => listener());
  };
  get(id?: string) { return id ? this.sessions.get(id) : undefined; }
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
    this.retired.set(crypto.randomUUID(), { session, root, state: 'restart-failed' });
    this.changed();
  }
  private restartTarget(id: string, session: RunnerSession, hidden = false): RestartTarget {
    const owns = () => !this.disposed && (hidden ? this.retired.get(id)?.session : this.sessions.get(id)) === session;
    return { name: session.view.name || 'Runner',
      ready: () => !owns() || session.restartReady || ['failed', 'exited'].includes(session.view.status),
      revalidation: () => ({ ...session.restartObservation,
        key: JSON.stringify([owns(), session.restartObservation.key]) }),
      restart: async () => {
        if (!owns()) return 'removed';
        if (['failed', 'exited'].includes(session.view.status)) throw new HubError(msg('restart.unavailable'));
        try { if (!await session.verifyRestart() || !session.restartReady) return 'pending'; }
        catch { return 'pending'; }
        if (!owns()) return 'removed';
        return this.replaceForRestart(id, session, hidden);
      } };
  }
  getFailure(id?: string) { return id && ['failed', 'restart-failed'].includes(this.retired.get(id)?.state ?? '') ? this.retired.get(id)?.session : undefined; }
  get failures() { return [...this.retired.entries()].filter(([, item]) => ['failed', 'restart-failed'].includes(item.state))
    .map(([id, item]) => ({ ...item.session.view, id, name: item.session.view.name || 'Runner' })); }
  view(id: string | null) {
    for (const session of this.sessions.values()) session.control.work.setViewed(session.view.id === id);
  }
  private waitForReplacement(session: RunnerSession, owns: () => boolean) {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (!owns()) { unsubscribe(); resolve(); return; }
        if (session.view.detail || ['failed', 'exited'].includes(session.view.status)
          || session.control.snapshot.state === 'disconnected') {
          unsubscribe(); reject(new HubError(session.view.detail || session.control.snapshot.detail || msg('restart.launchFailed')));
        } else if (session.restartReady) { unsubscribe(); resolve(); }
      };
      const unsubscribe = this.subscribe(check);
      check();
    });
  }
  private async replaceForRestart(id: string, session: RunnerSession, hidden: boolean): Promise<RestartOutcome> {
    const root = hidden ? this.retired.get(id)!.root : session.tab.installationRoot;
    const owns = () => !this.disposed && (hidden ? this.retired.get(id)?.session : this.sessions.get(id)) === session;
    const tab = hidden ? { installationRoot: root } : { ...session.tab, launchOnOpen: true };
    const defaults = hidden ? undefined : copy(this.selections.get(id)?.defaults ?? {});
    if (hidden) this.retired.get(id)!.state = 'checking';
    if (!await session.closeTab()) {
      this.retainRestartFailure(session, root);
      throw new HubError(msg('restart.cleanupFailed'));
    }
    if (!owns()) return 'removed';
    const replacement = new RunnerSession(tab, this.changed, hidden ? false : session.restored);
    replacement.setDraft(session.view.draft ?? '');
    if (hidden) {
      this.retired.set(id, { session: replacement, root, state: 'restarting' });
      replacement.retireTab(); replacement.hide();
    }
    else { this.sessions.set(id, replacement); this.bindSelections(replacement, defaults); }
    this.changed();
    const replacementOwned = () => !this.disposed
      && (hidden ? this.retired.get(id)?.session : this.sessions.get(id)) === replacement;
    try {
      await replacement.open(root);
      await this.waitForReplacement(replacement, replacementOwned);
    } catch (reason) {
      this.retainRestartFailure(session, root);
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
    return 'restarted';
  }
  close(id: string) {
    const session = this.sessions.get(id);
    if (!session || this.disposed) return false;
    const remaining = [...this.sessions.values()].filter(candidate => candidate !== session);
    if (!this.workspace.save(remaining.map(candidate => candidate.tab))) {
      session.closeFailure(new HubError(this.workspace.issue));
      return false;
    }
    this.retired.set(id, { session, root: session.tab.installationRoot, state: 'checking' });
    this.sessions.delete(id);
    this.selections.delete(id);
    session.retireTab();
    this.changed();
    void this.settleRemoved(id);
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
  private async terminateRemoved(id: string) {
    const item = this.retired.get(id);
    if (!item || item.state === 'terminating') return;
    item.state = 'terminating';
    item.session.retireTab();
    if (await item.session.closeTab()) {
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
    for (const tab of tabs) {
      const session = new RunnerSession(tab, this.changed, true);
      this.sessions.set(tab.id, session);
      this.bindSelections(session);
      this.order = Math.max(this.order, tab.createdOrder);
    }
    this.changed();
    for (const session of this.sessions.values()) {
      if (session.tab.launchOnOpen) void session.open(session.tab.installationRoot);
    }
  }
  create(location: string, token?: symbol) {
    if (this.disposed) throw new HubError(msg('spare.closed'));
    this.restore();
    const order = ++this.order;
    const session = new RunnerSession({ id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
      installationRoot: location, launchOnOpen: true }, this.changed);
    this.sessions.set(session.view.id, session);
    this.bindSelections(session);
    if (token && !session.reserve(token)) throw new HubError(msg('runtime.session.reservationFailed'));
    this.changed();
    return { session, launched: session.open(location) };
  }
  allocate(location: string, token?: symbol) {
    if (this.disposed) throw new HubError(msg('spare.closed'));
    for (const [id, item] of this.retired) {
      if (item.state !== 'idle' || item.root !== location || !item.session.reusableIdle) continue;
      const session = item.session;
      item.state = 'checking';
      if (token && !session.reserve(token)) { item.state = 'idle'; continue; }
      this.retired.delete(id);
      session.terminal.clear();
      session.terminal.write('\x1b[2J\x1b[3J\x1b[H');
      const order = ++this.order;
      session.promote({ id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
        installationRoot: location, launchOnOpen: true }, this.changed);
      this.sessions.set(session.view.id, session);
      this.bindSelections(session);
      this.changed();
      return { session, launched: Promise.resolve() };
    }
    if (this.spare.snapshot.state === 'ready' && this.spare.snapshot.installation?.root === location) {
      const session = this.promoteSpare();
      if (token && !session.reserve(token)) throw new HubError(msg('runtime.session.reservationFailed'));
      return { session, launched: Promise.resolve(), promoted: true };
    }
    return this.create(location, token);
  }
  promoteSpare() {
    if (this.disposed) throw new HubError(msg('spare.closed'));
    const installationRoot = this.spare.snapshot.installation?.root;
    if (!installationRoot) throw new HubError(msg('spare.verify'));
    const session = this.spare.take();
    const order = ++this.order;
    const tab = { id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
      installationRoot, launchOnOpen: true };
    session.promote(tab, this.changed);
    this.sessions.set(tab.id, session);
    this.bindSelections(session);
    this.changed();
    this.spare.replenish();
    return session;
  }
  dispose() {
    this.disposed = true;
    this.listeners.forEach(listener => listener());
    this.restarts.dispose();
    this.entry.attachments.dispose();
    return Promise.all([this.spare.dispose(), ...[...this.sessions.values(),
      ...[...this.retired.values()].map(item => item.session)].map(session => session.dispose())]);
  }
}
