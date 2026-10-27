import { msg, errorText, HubError } from './i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { openPty, type Pty } from '../../.runner/web-app-desktop/terminal/bridge';
import { RunnerInput } from './runnerInput';
import { RunnerControl, type ControlSnapshot } from './runnerControl';
import { RunnerReferenceSelection } from './referenceSelection';
import type { RunnerView } from './model';
import { SingleEntry, type EntryDefaults } from './singleEntry';
import { RunnerWorkspace, type RunnerTabRecord } from './RunnerWorkspace';
import '@xterm/xterm/css/xterm.css';

export class RunnerSession {
  readonly terminal = new Terminal({ cursorBlink: true, scrollback: 10000 });
  readonly fit = new FitAddon();
  readonly search = new SearchAddon();
  readonly input: RunnerInput;
  readonly control: RunnerControl;
  readonly references: RunnerReferenceSelection;
  private pty?: Pty;
  private pending: Uint8Array[] = [];
  private lastInput: Promise<void> = Promise.resolve();
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private reservation?: symbol;
  private inputUnsettled = false;
  private assignmentWriting = false;
  private deliveryUnknown = false;
  get submissionUncertain() { return this.deliveryUnknown; }
  view: RunnerView;
  tab: RunnerTabRecord;
  readonly previousContext: RunnerTabRecord['recoveryHint'];

  constructor(tab: RunnerTabRecord, private readonly changed: () => void, readonly restored = false) {
    this.tab = tab;
    this.previousContext = tab.recoveryHint;
    this.view = { id: tab.id, createdOrder: tab.createdOrder, name: tab.name,
      status: tab.launchOnOpen ? 'starting' : 'exited', canSubmit: false, draft: '', submitting: false };
    this.control = new RunnerControl(() => { this.captureVerified(); this.changed(); });
    this.references = new RunnerReferenceSelection(this.control, () => this.changed());
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
    if (!observation || !this.control.observationFresh) return;
    // Fresh settings do not confirm historical work recovery or retire its retained hint.
    this.tab = { ...this.tab, lastVerified: {
      target: { ...observation.target }, runMode: observation.run_mode,
      workflowKind: observation.execution.workflow_kind,
    } };
  }
  private protocolChanged() {
    if (this.input && this.view.canSubmit !== this.input.canSubmit) this.update({ canSubmit: this.input.canSubmit });
  }
  private error(reason: unknown) { this.update({ detail: errorText(reason) }); }
  private manualInput() {
    if (this.assignmentWriting) return false;
    if (this.references.locked && !this.references.results.some(result => result.state === 'pending-interaction')) return false;
    this.inputUnsettled = true;
    return true;
  }
  get assignmentAvailable() {
    return !this.disposed && !this.reservation && !this.inputUnsettled && !this.view.submitting && !this.references.prepared
      && !this.view.draft && this.view.status === 'running' && this.input.canSubmit;
  }
  get assignmentReserved() { return !!this.reservation; }
  reserve(token: symbol) {
    if (this.disposed || this.reservation || this.inputUnsettled || this.view.submitting || this.view.draft || this.references.prepared) return false;
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
    if (this.reservation !== token || this.inputUnsettled || this.disposed
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
  private queue(bytes: Uint8Array) {
    if (this.disposed || this.view.status === 'exited' || this.view.status === 'failed') return;
    if (!this.pty) { this.pending.push(bytes); return; }
    this.lastInput = this.pty.write(bytes);
    void this.lastInput.catch(reason => this.error(reason));
  }
  async open(location: string) {
    try {
      const request = { runnerLocation: location, cols: this.terminal.cols, rows: this.terminal.rows };
      const pty = await openPty(request, (bytes, consumed) => {
        if (this.disposed) consumed(); else this.terminal.write(bytes, consumed);
      }, event => {
        if (this.disposed) return;
        this.tab = { ...this.tab, launchOnOpen: false };
        const final = (event as typeof event & { control?: ControlSnapshot }).control;
        this.control.stop(msg('runtime.control.processExited'), final);
        this.references.dispose();
        this.update({ status: 'exited', exitCode: event.code, detail: event.error ?? undefined });
      }, reason => this.error(reason));
      this.pty = pty;
      if (this.disposed) { await pty.close(); return; }
      if (this.view.status === 'exited') { this.pending = []; return; }
      this.update({ status: 'running' });
      this.control.start(pty.id);
      for (const bytes of this.pending.splice(0)) await pty.write(bytes);
      await pty.resize(this.terminal.cols, this.terminal.rows);
    } catch (reason) {
      if (!this.pty) this.control.stop(msg('runtime.control.launchFailed'));
      this.update({ ...(this.pty ? {} : { status: 'failed' }), detail: errorText(reason) });
    }
  }
  rename(name: string) { this.tab = { ...this.tab, name }; this.update({ name }); }
  setDraft(draft: string) { if (!this.view.submitting) this.update({ draft }); }
  async submit() {
    if (this.view.status !== 'running' || !this.pty) throw new HubError(msg('runtime.session.notRunning'));
    if (this.view.submitting) throw new HubError(msg('runtime.session.submissionPending'));
    if (this.reservation) throw new HubError(msg('runtime.session.entryReserved'));
    if (this.deliveryUnknown) throw new HubError(msg('runtime.session.previousUnknown'));
    const draft = this.view.draft ?? '';
    const ordinary = !draft.trimStart().startsWith('/');
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
    if (this.view.status !== 'running') return;
    try { await this.pty?.close(); } catch (reason) { this.error(reason); }
  }
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
    this.disposed = true;
    this.control.stop(msg('runtime.control.workspaceClosed'));
    this.references.dispose();
    clearTimeout(this.resizeTimer);
    this.pending = [];
    void this.pty?.close().catch(reason => console.error('Runner cleanup failed', reason));
    this.input.dispose();
    this.terminal.dispose();
  }
}

export class RunnerSessions {
  private readonly sessions = new Map<string, RunnerSession>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly RunnerView[] = [];
  private order = 0;
  private restored = false;
  private disposed = false;
  readonly workspace = new RunnerWorkspace();
  private consumers = 0;
  readonly entry: SingleEntry;
  constructor(defaults: EntryDefaults = {}, saveDefaults: (value: EntryDefaults) => void = () => {}) {
    this.entry = new SingleEntry(() => [...this.sessions.values()],
      (location, token) => this.create(location, token), () => this.changed(), defaults, saveDefaults);
  }
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private readonly changed = () => {
    if (this.disposed) return;
    this.workspace.save([...this.sessions.values()].map(session => session.tab));
    this.snapshot = [...this.sessions.values()].map(session => session.view);
    this.listeners.forEach(listener => listener());
  };
  get(id?: string) { return id ? this.sessions.get(id) : undefined; }
  retain() {
    this.consumers++;
    this.restore();
    return () => {
      this.consumers--;
      queueMicrotask(() => { if (!this.consumers) this.dispose(); });
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
  dispose() { this.disposed = true; this.sessions.forEach(session => session.dispose()); }
}
