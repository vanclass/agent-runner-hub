import type { RunnerView } from './model';
import { runModes, type RunnerWork } from './runnerWork';

export type RunMode = typeof runModes[number];
export type DomainDisplay = 'unified' | 'run-mode';
export type NavigationPresentation = {
  executedModes: RunMode[];
  order: string[];
  affinities: Record<string, RunMode>;
};
export type RunnerDomain = { id: 'runner' | RunMode; runners: readonly RunnerView[] };
export const emptyPresentation = (): NavigationPresentation => ({ executedModes: [], order: [], affinities: {} });

/** Presentation only: work/process identities and settings remain with their existing owners. */
export class RunnerNavigation {
  private value = emptyPresentation();
  private readonly latest = new WeakMap<RunnerWork, Map<string, number>>();
  constructor(private readonly changed: () => void) {}
  get snapshot(): NavigationPresentation { return structuredClone(this.value); }
  restore(value: NavigationPresentation) { this.value = structuredClone(value); }
  observe(id: string | undefined, work: RunnerWork) {
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
    }
  }
  intent(id: string, mode?: RunMode) {
    if (mode) { this.value.affinities[id] = mode; this.changed(); }
  }
  project(runners: readonly RunnerView[], display: DomainDisplay): RunnerDomain[] {
    const ordered = [...runners].sort((a, b) => {
      const rank = (id: string) => { const n = this.value.order.indexOf(id); return n < 0 ? Infinity : n; };
      return rank(a.id) - rank(b.id) || a.createdOrder - b.createdOrder;
    });
    if (display === 'unified') return [{ id: 'runner', runners: ordered }];
    const modes = runModes.filter(mode => this.value.executedModes.includes(mode));
    return modes.map(mode => ({ id: mode, runners: ordered.filter(runner => {
      const affinity = this.value.affinities[runner.id];
      return (modes.includes(affinity) ? affinity : modes[0]) === mode;
    }) }));
  }
  reorder(runners: readonly RunnerView[], display: DomainDisplay, domainId: RunnerDomain['id'],
    id: string, before: string | null, expectedIds: readonly string[]) {
    const domain = this.project(runners, display).find(d => d.id === domainId);
    const ids = domain?.runners.map(r => r.id);
    if (!ids || ids.join() !== expectedIds.join() || !ids.includes(id)
      || before === id || before !== null && !ids.includes(before)) return;
    const reordered = ids.filter(candidate => candidate !== id);
    reordered.splice(before === null ? reordered.length : reordered.indexOf(before), 0, id);
    const all = this.project(runners, display).flatMap(d => d.runners.map(r => r.id));
    let index = 0;
    this.value.order = all.map(candidate => ids.includes(candidate) ? reordered[index++] : candidate);
    this.changed();
  }
}
