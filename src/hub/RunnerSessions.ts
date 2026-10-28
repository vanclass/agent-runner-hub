import { msg, errorText, HubError } from './i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { openPty, type Pty } from '../../.runner/web-app-desktop/terminal/bridge';
import { RunnerInput } from './runnerInput';
import { RunnerControl, commandNamed, type ControlSnapshot } from './runnerControl';
import { RunnerReferenceSelection } from './referenceSelection';
import type { RunnerView } from './model';
import { SingleEntry, type EntryDefaults } from './singleEntry';
import { RunnerWorkspace, type RunnerTabRecord } from './RunnerWorkspace';
import { RunnerSpare } from './RunnerSpare';
import type { RunnerInstallation } from './runnerInstallation';
import { same } from './runnerConfigContract';
import '@xterm/xterm/css/xterm.css';

export class RunnerSession {
  readonly terminal = new Terminal({ cursorBlink: true, scrollback: 10000 });
  readonly fit = new FitAddon();
  readonly search = new SearchAddon();
  readonly input: RunnerInput;
  readonly control: RunnerControl;
  readonly references: RunnerReferenceSelection;
  private pty?: Pty;
  private opening?: Promise<void>;
  private cleanup?: Promise<void>;
  private pending: Uint8Array[] = [];
  private lastInput: Promise<void> = Promise.resolve();
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private reservation?: symbol;
  private inputUnsettled = false;
  private assignmentWriting = false;
  private deliveryUnknown = false;
  private nativeState: 'unverified' | 'open' | 'closing' | 'settled' | 'failed' = 'unverified';
  private get nativeSettled() { return this.nativeState === 'settled'; }
  private get exitObserved() { return this.nativeState === 'settled' || this.nativeState === 'failed'; }
  get submissionUncertain() { return this.deliveryUnknown; }
  view: RunnerView;
  private tabRecord?: RunnerTabRecord;
  get tab() {
    if (!this.tabRecord) throw new Error('Hidden Runner has no workspace tab');
    return this.tabRecord;
  }
  readonly previousContext: RunnerTabRecord['recoveryHint'];

  constructor(tab: RunnerTabRecord | Pick<RunnerTabRecord, 'installationRoot'>,
    private changed: () => void, readonly restored = false) {
    this.tabRecord = 'id' in tab ? tab : undefined;
    if (this.tabRecord?.launchOnOpen === false) this.nativeState = 'settled';
    this.previousContext = this.tabRecord?.recoveryHint;
    // Empty display fields remain private until the workspace assigns a tab at promotion.
    this.view = { id: this.tabRecord?.id ?? '', createdOrder: this.tabRecord?.createdOrder ?? 0,
      name: this.tabRecord?.name ?? '', status: this.tabRecord?.launchOnOpen === false ? 'exited' : 'starting',
      canSubmit: false, draft: '', submitting: false };
    this.control = new RunnerControl(() => { if (!this.disposed) { this.captureVerified(); this.changed(); } });
    this.references = new RunnerReferenceSelection(this.control, () => { if (!this.disposed) this.changed(); });
    this.terminal.loadAddon(this.fit);
    this.terminal.loadAddon(this.search);
    this.input = new RunnerInput(this.terminal, text => this.queue(new TextEncoder().encode(text)),
      () => this.protocolChanged(), () => this.manualInput());
    this.terminal.onWriteParsed(() => this.protocolChanged());
    this.terminal.onBinary(data => { if (this.manualInput()) this.queue(Uint8Array.from(data, char => char.charCodeAt(0))); });
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
  private manualInput() {
    if (this.view.closing) return false;
    if (this.assignmentWriting) return false;
    if (this.reservation && this.control.assignmentLocked
      && !this.control.snapshot.observation?.attention.foreground_interaction_active
      && this.control.config.progress?.state !== 'pending-interaction'
      && this.control.work.progress?.state !== 'pending-interaction') return false;
    if (this.references.locked && !this.references.results.some(result => result.state === 'pending-interaction')) return false;
    this.inputUnsettled = true;
    return true;
  }
  get assignmentAvailable() {
    return !this.disposed && !this.view.closing && !this.reservation && !this.control.config.busy && !this.control.config.uncertain
      && !this.control.work.blocked && !this.control.work.busy
      && !this.inputUnsettled && !this.view.submitting && !this.references.prepared
      && !this.view.draft && this.view.status === 'running' && this.input.canSubmit;
  }
  get assignmentReserved() { return !!this.reservation; }
  private get idleForClose() {
    const control = this.control, snapshot = control.snapshot, observation = snapshot.observation;
    if (this.disposed || this.nativeState !== 'open' || !this.pty || this.view.status !== 'running' || !control.observationFresh || !observation
      || this.reservation || this.inputUnsettled || this.deliveryUnknown || this.view.submitting || this.view.draft
      || control.pending || control.config.uncertain || control.work.blocked || !this.references.capable || this.references.prepared) return false;
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
  get middleCloseEligible() { return !this.view.closing && (this.nativeSettled || this.idleForClose); }
  get tabView(): RunnerView {
    let activity = this.control.work.activity;
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
      || this.inputUnsettled || this.view.submitting || this.view.draft || this.references.prepared) return false;
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
    if (this.reservation !== token || this.inputUnsettled || this.disposed || this.view.closing
      || this.view.status !== 'running' || !this.pty || !this.input.canSubmit) {
      throw new HubError(msg('runtime.session.ownershipChanged'));
    }
    this.assignmentWriting = true;
    this.inputUnsettled = true;
    this.update({ submitting: true });
    try {
      this.input.submit(text);
      await this.lastInput;
      return { delivered: true, detail: msg('runtime.session.delivered') };
    } catch (reason) {
      return { delivered: false, detail: msg('runtime.session.deliveryFailure', { diagnostic: errorText(reason) }) };
    } finally {
      this.assignmentWriting = false;
      this.update({ submitting: false });
    }
  }
  ownsAssignment(token: symbol) {
    return this.reservation === token && !this.disposed && !this.view.closing && !this.inputUnsettled && !this.view.draft
      && !this.view.submitting && !this.references.prepared && this.view.status === 'running'
      && this.input.canSubmit && !this.control.config.uncertain && !this.control.work.blocked;
  }
  async submitWork(token: symbol, instruction: string) {
    if (!this.ownsAssignment(token)) throw new HubError(msg('runtime.session.ownershipChanged'));
    this.update({ submitting: true });
    try { return await this.control.work.submit(instruction); }
    finally { this.update({ submitting: false }); }
  }
  private queue(bytes: Uint8Array) {
    if (this.disposed || this.view.closing || this.view.status === 'exited' || this.view.status === 'failed') return;
    if (!this.pty) { this.pending.push(bytes); return; }
    this.lastInput = this.pty.write(bytes);
    void this.lastInput.catch(reason => this.error(reason));
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
    this.tabRecord = tab;
    this.changed = changed;
    this.captureVerified();
    this.update({ id: tab.id, name: tab.name, createdOrder: tab.createdOrder });
  }
  rename(name: string) { this.tabRecord = { ...this.tab, name }; this.update({ name }); }
  setDraft(draft: string) { if (!this.view.submitting) this.update({ draft }); }
  async submit() {
    if (this.view.closing) throw new HubError(msg('tabs.closing'));
    if (this.view.status !== 'running' || !this.pty) throw new HubError(msg('runtime.session.notRunning'));
    if (this.view.submitting) throw new HubError(msg('runtime.session.submissionPending'));
    if (this.reservation) throw new HubError(msg('runtime.session.entryReserved'));
    if (this.deliveryUnknown) throw new HubError(msg('runtime.session.previousUnknown'));
    const draft = this.view.draft ?? '';
    const ordinary = !draft.trimStart().startsWith('/');
    const answering = this.control.observationFresh && this.control.snapshot.observation?.attention.foreground_interaction_active;
    if (ordinary && this.control.work.blocked && !answering) throw new HubError(msg('work.retained',
      { state: this.control.work.current?.work?.state || 'unknown' }));
    let attempted = false, delivered = false;
    this.update({ submitting: true });
    try {
      if (ordinary) await this.references.preflight();
      if (this.disposed || this.view.status !== 'running' || !this.input.canSubmit)
        throw new HubError(msg('runtime.session.inputUnavailable'));
      if (ordinary) this.references.assertReadyForDelivery();
      this.assignmentWriting = true;
      this.inputUnsettled = true;
      attempted = true;
      this.input.submit(draft);
      const delivery = this.lastInput;
      await delivery;
      delivered = true;
      this.update({ draft: '' });
    } catch (reason) {
      if (attempted) {
        this.deliveryUnknown = true;
        throw new HubError(msg('runtime.session.deliveryUnknown'));
      }
      throw reason;
    } finally {
      this.assignmentWriting = false;
      if (ordinary) this.references.finishSubmission(delivered);
      this.update({ submitting: false });
    }
  }
  async terminate() {
    if (this.view.closing || this.view.status !== 'running') return;
    this.nativeState = 'closing';
    try { await this.pty?.close(); } catch (reason) { this.error(reason); }
  }
  async closeTab(method: 'middle' | 'explicit') {
    if (this.view.closing || method === 'middle' && !this.middleCloseEligible) return false;
    if (this.disposed) return this.nativeSettled;
    this.control.tabClosing = true;
    this.update({ closing: true });
    try {
      if (method === 'middle' && !this.nativeSettled) {
        await this.control.fresh();
        if (!this.idleForClose) throw new HubError(msg('tabs.idleRequired'));
        await this.references.verifyAssignment();
        if (!this.idleForClose) throw new HubError(msg('tabs.idleRequired'));
      }
      await this.opening;
      if (!this.nativeSettled) {
        if (!this.pty || this.exitObserved) throw new HubError(msg('tabs.unconfirmed'));
        this.nativeState = 'closing';
        await this.pty.close();
        const deadline = performance.now() + 10000;
        while (!this.exitObserved && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (!this.nativeSettled) throw new HubError(msg('tabs.unconfirmed'));
      }
      return true;
    } catch (reason) { this.error(reason); return false; }
    finally { this.control.tabClosing = false; this.update({ closing: false }); }
  }
  closeFailure(reason: unknown) { this.update({ detail: errorText(reason) }); }
  attach(container: HTMLElement, theme: 'light' | 'black') {
    if (this.terminal.element) container.appendChild(this.terminal.element);
    else this.terminal.open(container);
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
  private readonly closing = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly RunnerView[] = [];
  private order = 0;
  private restored = false;
  private disposed = false;
  readonly workspace = new RunnerWorkspace();
  private consumers = 0;
  private readonly spare = new RunnerSpare(
    (installationRoot, changed) => new RunnerSession({ installationRoot }, changed), () => this.changed());
  get spareSnapshot() { return this.spare.snapshot; }
  setInstallation(installation: RunnerInstallation | null) { this.spare.setInstallation(installation); }
  readonly entry: SingleEntry;
  constructor(defaults: EntryDefaults = {}, saveDefaults: (value: EntryDefaults) => void = () => {}) {
    this.entry = new SingleEntry(() => [...this.sessions.values()],
      (location, token) => this.allocate(location, token), () => this.changed(), defaults, saveDefaults,
      () => this.spare.optionsSource ?? [...this.sessions.values()].find(s => s.assignmentAvailable));
  }
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private readonly changed = () => {
    if (this.disposed) return;
    this.entry?.observe();
    this.workspace.save([...this.sessions.values()].map(session => session.tab));
    this.snapshot = [...this.sessions.values()].map(session => session.tabView);
    this.listeners.forEach(listener => listener());
  };
  get(id?: string) { return id ? this.sessions.get(id) : undefined; }
  view(id: string | null) {
    for (const session of this.sessions.values()) session.control.work.setViewed(session.view.id === id);
  }
  async close(id: string, method: 'middle' | 'explicit') {
    if (this.closing.has(id)) return false;
    const session = this.sessions.get(id);
    this.closing.add(id);
    try {
      if (!session || !await session.closeTab(method) || this.disposed || this.sessions.get(id) !== session) return false;
      const remaining = [...this.sessions.values()].filter(candidate => candidate !== session);
      if (!this.workspace.save(remaining.map(candidate => candidate.tab))) {
        session.closeFailure(new HubError(this.workspace.issue));
        return false;
      }
      if (this.disposed || this.sessions.get(id) !== session) return false;
      const cleanup = session.dispose();
      this.sessions.delete(id);
      this.changed();
      await cleanup;
      return true;
    } catch (reason) { session?.closeFailure(reason); return false; }
    finally { this.closing.delete(id); }
  }
  retain() {
    this.consumers++;
    this.restore();
    return () => {
      this.consumers--;
      queueMicrotask(() => {
        if (!this.consumers) void this.dispose().catch(reason => console.error('Runner cleanup failed', reason));
      });
    };
  }
  restore() {
    if (this.restored) return;
    this.restored = true;
    const tabs = this.workspace.load();
    for (const tab of tabs) {
      const session = new RunnerSession(tab, this.changed, true);
      this.sessions.set(tab.id, session);
      this.order = Math.max(this.order, tab.createdOrder);
    }
    this.changed();
    for (const session of this.sessions.values()) {
      if (session.tab.launchOnOpen) void session.open(session.tab.installationRoot);
    }
    this.spare.restore();
  }
  create(location: string, token?: symbol) {
    const order = ++this.order;
    const session = new RunnerSession({ id: crypto.randomUUID(), createdOrder: order, name: `Runner ${order}`,
      installationRoot: location, launchOnOpen: true }, this.changed);
    this.sessions.set(session.view.id, session);
    if (token && !session.reserve(token)) throw new HubError(msg('runtime.session.reservationFailed'));
    this.changed();
    return { session, launched: session.open(location) };
  }
  private allocate(location: string, token: symbol) {
    if (this.spare.snapshot.state === 'ready' && this.spare.snapshot.installation?.root === location) {
      const session = this.promoteSpare();
      if (!session.reserve(token)) throw new HubError(msg('runtime.session.reservationFailed'));
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
    this.changed();
    this.spare.replenish();
    return session;
  }
  dispose() {
    this.disposed = true;
    return Promise.all([this.spare.dispose(), ...[...this.sessions.values()].map(session => session.dispose())]);
  }
}
