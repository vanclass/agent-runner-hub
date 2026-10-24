import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { openPty, type Pty } from '../../.runner/web-app-desktop/terminal/bridge';
import { RunnerInput } from './runnerInput';
import type { RunnerView } from './model';
import '@xterm/xterm/css/xterm.css';

export class RunnerSession {
  readonly terminal = new Terminal({ cursorBlink: true, scrollback: 10000 });
  readonly fit = new FitAddon();
  readonly search = new SearchAddon();
  readonly input: RunnerInput;
  private pty?: Pty;
  private pending: Uint8Array[] = [];
  private lastInput: Promise<void> = Promise.resolve();
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  view: RunnerView;

  constructor(id: string, order: number, private readonly changed: () => void) {
    this.view = { id, createdOrder: order, name: `Runner ${order}`, status: 'starting', canSubmit: false, draft: '', submitting: false };
    this.terminal.loadAddon(this.fit);
    this.terminal.loadAddon(this.search);
    this.input = new RunnerInput(this.terminal, text => this.queue(new TextEncoder().encode(text)), () => this.protocolChanged());
    this.terminal.onWriteParsed(() => this.protocolChanged());
    this.terminal.onBinary(data => this.queue(Uint8Array.from(data, char => char.charCodeAt(0))));
    this.terminal.onResize(({ cols, rows }) => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        if (this.view.status === 'running') void this.pty?.resize(cols, rows).catch(reason => this.error(reason));
      }, 30);
    });
  }
  private update(change: Partial<RunnerView>) { this.view = { ...this.view, ...change }; this.changed(); }
  private protocolChanged() {
    if (this.input && this.view.canSubmit !== this.input.canSubmit) this.update({ canSubmit: this.input.canSubmit });
  }
  private error(reason: unknown) { this.update({ detail: String(reason) }); }
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
      }, event => this.update({ status: 'exited', exitCode: event.code, detail: event.error ?? undefined }), reason => this.error(reason));
      this.pty = pty;
      if (this.disposed) { await pty.close(); return; }
      if (this.view.status === 'exited') { this.pending = []; return; }
      this.update({ status: 'running' });
      for (const bytes of this.pending.splice(0)) await pty.write(bytes);
      await pty.resize(this.terminal.cols, this.terminal.rows);
    } catch (reason) {
      this.update({ ...(this.pty ? {} : { status: 'failed' }), detail: String(reason) });
    }
  }
  rename(name: string) { this.update({ name }); }
  setDraft(draft: string) { if (!this.view.submitting) this.update({ draft }); }
  async submit() {
    if (this.view.status !== 'running' || !this.pty) throw new Error('This Runner process is not running.');
    if (this.view.submitting) throw new Error('Input submission is already pending for this Runner.');
    this.update({ submitting: true });
    try {
      this.input.submit(this.view.draft ?? '');
      await this.lastInput;
      this.update({ draft: '' });
    } finally { this.update({ submitting: false }); }
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
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private readonly changed = () => {
    this.snapshot = [...this.sessions.values()].map(session => session.view);
    this.listeners.forEach(listener => listener());
  };
  get(id?: string) { return id ? this.sessions.get(id) : undefined; }
  create(location: string) {
    const session = new RunnerSession(crypto.randomUUID(), ++this.order, this.changed);
    this.sessions.set(session.view.id, session);
    this.changed();
    return { session, launched: session.open(location) };
  }
  dispose() { this.sessions.forEach(session => session.dispose()); }
}
