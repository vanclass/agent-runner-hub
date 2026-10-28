import { errorText, HubError, msg, type HubText } from './i18n';
import type { RunnerSession } from './RunnerSessions';
import { idleReason } from './singleEntry';
import type { RunnerInstallation } from './runnerInstallation';

type SpareSnapshot = Readonly<{
  state: 'unavailable' | 'preparing' | 'ready' | 'disposed';
  detail: HubText;
  installation: Readonly<RunnerInstallation> | null;
}>;
type Slot = { session: RunnerSession; generation: number; launched: boolean; timer?: ReturnType<typeof setTimeout> };

// Owns only speculative session lifetime. RunnerSession and the native registry still own all PTY resources.
export class RunnerSpare {
  private current: SpareSnapshot = { state: 'unavailable', detail: msg('spare.verify'), installation: null };
  private generation = 0;
  private slot?: Slot;
  private work: Promise<void> = Promise.resolve();
  private cleanupFailure?: HubText;

  constructor(private readonly create: (root: string, changed: () => void) => RunnerSession,
    private readonly changed: () => void) {}

  get snapshot(): SpareSnapshot {
    if (this.current.state === 'ready' && this.slot) {
      const reason = this.readinessReason(this.slot.session);
      if (reason) return { ...this.current, state: 'unavailable', detail: msg('spare.unavailable', { reason }) };
    }
    return this.current;
  }
  get optionsSource() { return this.snapshot.state === 'ready' ? this.slot?.session : undefined; }
  setInstallation(installation: RunnerInstallation | null) {
    if (this.current.state === 'disposed') return;
    if (installation && this.current.installation?.root === installation.root
      && this.current.installation.python === installation.python && this.slot) return;
    this.prepare(installation);
  }
  private prepare(installation: RunnerInstallation | null) {
    const generation = ++this.generation;
    const cleanup = this.retire();
    this.current = { installation, state: installation ? 'preparing' : 'unavailable',
      detail: msg(installation ? 'spare.preparing' : 'spare.verify') };
    this.changed();
    // Join the previous launch and its exact cleanup before admitting a new hidden process.
    this.work = Promise.all([this.work, cleanup]).then(async () => {
      if (!this.active(generation)) return;
      if (this.cleanupFailure) throw new HubError(this.cleanupFailure);
      const verified = installation;
      if (!this.active(generation) || !verified) return;
      this.current = { ...this.current, installation: verified };
      await this.launch(verified.root, generation);
    }).catch(reason => {
      if (this.active(generation)) this.fail(errorText(reason));
    });
  }
  private active(generation: number) {
    return this.current.state !== 'disposed' && this.generation === generation;
  }
  private owns(slot: Slot) { return this.slot === slot && this.active(slot.generation); }
  private async launch(root: string, generation: number) {
    const session = this.create(root, () => { if (this.slot?.session === session) this.observe(this.slot); });
    const slot: Slot = { session, generation, launched: false };
    this.slot = slot;
    slot.timer = setTimeout(() => {
      if (this.owns(slot)) this.fail(msg('spare.timeout'));
    }, 40000);
    await session.open(root);
    if (!this.owns(slot)) return;
    slot.launched = true;
    this.observe(slot);
  }
  private readinessReason(session: RunnerSession): HubText {
    return session.view.detail || this.canonicalReason(session) || (!session.assignmentAvailable || session.control.busy
      || session.control.config.uncertain ? msg('spare.inputUnavailable') : '');
  }
  private canonicalReason(session: RunnerSession): HubText {
    const observation = session.control.snapshot.observation;
    return idleReason(session) || (!observation?.selection.account || !observation.selection.model
      || !observation.selection.source || !observation.run_mode ? msg('runtime.entry.settingsIncomplete') : '');
  }
  private observe(slot: Slot) {
    if (!this.owns(slot)) return;
    const session = slot.session;
    if (session.view.detail || session.view.status === 'failed' || session.view.status === 'exited') {
      this.fail(session.view.detail || msg('spare.exited'));
      return;
    }
    if (session.control.snapshot.state === 'disconnected') {
      this.fail(session.control.snapshot.detail || msg('spare.controlUnavailable'));
      return;
    }
    if (slot.launched && session.control.observationFresh && session.control.snapshot.observation) {
      const reason = this.canonicalReason(session);
      if (reason) { this.fail(reason); return; }
      if (!this.readinessReason(session)) {
        clearTimeout(slot.timer);
        this.current = { ...this.current, state: 'ready', detail: msg('spare.ready') };
      } else {
        this.current = { ...this.current, state: 'preparing', detail: msg('spare.preparing') };
      }
    }
    this.changed();
  }
  private retire() {
    const slot = this.slot;
    this.slot = undefined;
    clearTimeout(slot?.timer);
    return (slot?.session.dispose() ?? Promise.resolve()).catch(reason => {
      this.cleanupFailure = errorText(reason);
      throw reason;
    });
  }
  private fail(reason: HubText) {
    const generation = ++this.generation;
    const cleanup = this.retire();
    this.current = { ...this.current, state: 'unavailable', detail: this.cleanupFailure
      ? msg('spare.cleanupFailed', { reason: this.cleanupFailure }) : msg('spare.unavailable', { reason }) };
    this.changed();
    this.work = Promise.all([this.work, cleanup]).then(() => {}, cleanupError => {
      if (this.active(generation)) {
        this.current = { ...this.current, detail: msg('spare.cleanupFailed', { reason: errorText(cleanupError) }) };
        this.changed();
      }
      throw cleanupError;
    });
    // Keep cleanup failure observable without an unhandled rejection or an automatic retry.
    void this.work.catch(() => {});
  }
  take() {
    const slot = this.slot;
    const snapshot = this.snapshot;
    if (!slot || snapshot.state !== 'ready' || this.readinessReason(slot.session))
      throw new HubError(snapshot.detail);
    this.slot = undefined;
    clearTimeout(slot.timer);
    this.current = { ...this.current, state: 'unavailable', detail: msg('spare.preparing') };
    return slot.session;
  }
  replenish() {
    if (this.current.state !== 'disposed' && !this.slot && this.current.installation)
      this.prepare(this.current.installation);
  }
  dispose() {
    if (this.current.state === 'disposed') return this.work;
    ++this.generation;
    this.current = { state: 'disposed', detail: msg('spare.closed'), installation: null };
    this.work = Promise.all([this.work, this.retire()]).then(() => {
      if (this.cleanupFailure) throw new HubError(this.cleanupFailure);
    });
    return this.work;
  }
}
