import { errorText, type HubText } from './i18n';

export type RestartOutcome = 'pending' | 'restarted' | 'removed';
export type RestartTarget = Readonly<{
  name: string;
  ready: () => boolean;
  restart: () => Promise<RestartOutcome>;
}>;
type RestartItem = { target: RestartTarget; state: RestartOutcome | 'running' | 'failed'; detail?: HubText };

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
      failures: this.items.filter(item => item.state === 'failed').map(item => ({ name: item.target.name, detail: item.detail! })) };
  }
  request(targets: readonly RestartTarget[]) {
    if (this.disposed || this.pending) return false;
    this.requested = true;
    this.items = targets.map(target => ({ target, state: 'pending' }));
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
      if (item.state !== 'pending' || !item.target.ready()) continue;
      --capacity;
      item.state = 'running';
      void this.run(item);
    }
  }
  private async run(item: RestartItem) {
    this.changed();
    try { item.state = await item.target.restart(); }
    catch (reason) { item.state = 'failed'; item.detail = errorText(reason); }
    if (!this.disposed) this.changed();
  }
  dispose() { this.disposed = true; }
}
