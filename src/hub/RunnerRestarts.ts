import { errorText, type HubText } from './i18n';

type RestorationSuccess = 'context-restored' | 'mode-restored';
type RestorationProblem = 'restoration-failed' | 'restoration-uncertain';
export type RestartOutcome = 'pending' | 'restarted' | 'removed' | RestorationSuccess
  | { state: RestorationProblem; detail: HubText };
export type RestartTarget = Readonly<{
  name: string;
  ready: () => boolean;
  revalidation?: () => string;
  restart: () => Promise<RestartOutcome>;
}>;
type RestartItem = { name: string; target?: RestartTarget;
  state: Exclude<RestartOutcome, object> | RestorationProblem | 'running' | 'failed'; detail?: HubText;
  waiting?: { key?: string }; wasReady?: boolean };

// One explicit, process-local capture. Session owners alone decide safe release and replacement.
export class RunnerRestarts {
  private items: RestartItem[] = [];
  private disposed = false;
  private scheduled = false;
  private requested = false;
  constructor(private readonly changed: () => void) {}
  get pending() { return this.items.some(item => item.state === 'pending' || item.state === 'running'); }
  get snapshot() {
    const count = (state: RestartItem['state']) => this.items.filter(item => item.state === state).length;
    return { requested: this.requested, total: this.items.length, pending: count('pending'), running: count('running'),
      restarted: count('restarted'), removed: count('removed'), failed: count('failed'),
      contextRestored: count('context-restored'), modeRestored: count('mode-restored'),
      restorationFailed: count('restoration-failed'), restorationUncertain: count('restoration-uncertain'),
      failures: this.items.filter(item => item.detail !== undefined).map(item => ({ name: item.name, detail: item.detail! })) };
  }
  request(targets: readonly RestartTarget[]) {
    if (this.disposed || this.pending) return false;
    this.requested = true;
    this.items = targets.map(target => ({ target, name: target.name, state: 'pending' }));
    this.changed();
    this.observe();
    return true;
  }
  observe() {
    if (this.disposed || this.scheduled || !this.pending) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }
  private pump() {
    if (this.disposed) return;
    // Native launches share host resources; at most two independent owners settle at once.
    let capacity = 2 - this.items.filter(item => item.state === 'running').length;
    for (const item of this.items) {
      if (!capacity) break;
      const target = item.target;
      if (item.state !== 'pending' || !target) continue;
      const ready = target.ready(), observation = target.revalidation?.();
      const becameReady = !observation && item.wasReady === false && ready;
      item.wasReady = ready;
      if (!ready || item.waiting && !becameReady && observation === item.waiting.key) continue;
      --capacity;
      item.state = 'running';
      void this.run(item, target);
    }
  }
  private async run(item: RestartItem, target: RestartTarget) {
    this.changed();
    try {
      const outcome = await target.restart();
      if (typeof outcome === 'string') item.state = outcome;
      else { item.state = outcome.state; item.detail = outcome.detail; }
    }
    catch (reason) { item.state = 'failed'; item.detail = errorText(reason); }
    if (item.state === 'pending') {
      // Verification's own receipts must not re-admit the same unchanged context.
      item.waiting = { key: target.revalidation?.() };
      item.wasReady = target.ready();
    } else item.target = undefined;
    if (!this.disposed) this.changed();
  }
  dispose() { this.disposed = true; this.items.forEach(item => { item.target = undefined; }); }
}
