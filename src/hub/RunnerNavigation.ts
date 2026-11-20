import type { RunnerView } from './model';
import { runModes, type RunnerWork } from './runnerWork';

export type RunMode = typeof runModes[number];
export type DomainDisplay = 'unified' | 'run-mode';
export type NavigationPresentation = {
  executedModes: string[];
  order: string[];
  affinities: Record<string, string>;
};
export type RunnerDomain = { id: 'runner' | RunMode; runners: readonly RunnerView[] };
export type DomainCapture = { domain: RunnerDomain['id']; ids: readonly string[] };
export type RunnerDrop = {
  id: string;
  source: DomainCapture;
  destination: DomainCapture;
  before: string | null;
};
export const emptyPresentation = (): NavigationPresentation => ({ executedModes: [], order: [], affinities: {} });

/** Presentation only: work/process identities and settings remain with their existing owners. */
export class RunnerNavigation {
  private value = emptyPresentation();
  private readonly latest = new WeakMap<RunnerWork, Map<string, number>>();
  constructor(private readonly changed: () => void) {}
  get snapshot(): NavigationPresentation { return structuredClone(this.value); }
  restore(value: NavigationPresentation) { this.value = structuredClone(value); }
  observe(id: string | undefined, work: RunnerWork, context?: string) {
    for (const attempt of work.attempts) {
      if (!work.hasConfirmedStart(attempt)) continue;
      const mode = attempt.work!.run_mode as RunMode;
      if (!this.value.executedModes.includes(mode)) this.value.executedModes.push(mode);
    }
    if (!id) return;
    const started = work.presentedAttempts.filter(a => work.hasConfirmedStart(a));
    const newest = started.reduce<typeof started[number] | undefined>((a, b) =>
      !a || b.work!.started_event_id > a.work!.started_event_id ? b : a, undefined);
    const seen = this.latest.get(work) ?? new Map<string, number>();
    this.latest.set(work, seen);
    if (newest && newest.work!.started_event_id > (seen.get(id) ?? 0)) {
      seen.set(id, newest.work!.started_event_id);
      this.value.affinities[id] = newest.work!.run_mode as RunMode;
    } else if (!newest && !this.value.affinities[id] && runModes.includes(context as RunMode)) {
      this.value.affinities[id] = context as RunMode;
    }
  }
  setRequestedMode(id: string, work: RunnerWork, mode: RunMode) {
    this.observe(id, work);
    this.value.affinities[id] = mode;
  }
  project(runners: readonly RunnerView[], display: DomainDisplay): RunnerDomain[] {
    const ordered = [...runners].sort((a, b) => {
      const rank = (id: string) => { const n = this.value.order.indexOf(id); return n < 0 ? Infinity : n; };
      return rank(a.id) - rank(b.id) || a.createdOrder - b.createdOrder;
    });
    if (display === 'unified') return [{ id: 'runner', runners: ordered }];
    const placement = (runner: RunnerView) => {
      const mode = this.value.affinities[runner.id];
      return runModes.includes(mode as RunMode) ? mode : 'task-run';
    };
    return runModes.map(mode => ({ id: mode, runners: ordered.filter(runner => placement(runner) === mode) }))
      .filter(domain => domain.runners.length > 0);
  }
  reorder(runners: readonly RunnerView[], display: DomainDisplay, drop: RunnerDrop) {
    if (drop.source.domain !== drop.destination.domain) return;
    const commit = this.prepareDropOrder(runners, display, drop);
    if (!commit) return;
    commit();
    this.changed();
  }
  prepareDropOrder(runners: readonly RunnerView[], display: DomainDisplay, { id, source, destination, before }: RunnerDrop) {
    const domains = this.project(runners, display);
    const matches = (capture: DomainCapture) => {
      const rows = domains.find(domain => domain.id === capture.domain)?.runners;
      return rows?.length === capture.ids.length && rows.every((row, index) => row.id === capture.ids[index]);
    };
    if (!matches(source) || !matches(destination) || !source.ids.includes(id)
      || before === id || (before !== null && !destination.ids.includes(before))) return;
    const inserted = destination.ids.filter(candidate => candidate !== id);
    inserted.splice(before === null ? inserted.length : inserted.indexOf(before), 0, id);
    const order = domains.flatMap(domain => domain.id === destination.domain
      ? inserted : domain.runners.map(row => row.id).filter(candidate => candidate !== id));
    return () => { this.value.order = order; };
  }
}
