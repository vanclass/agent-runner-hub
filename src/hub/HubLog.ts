import { invoke } from '@tauri-apps/api/core';

export type HubEvent = { component: string; operation: string; runner: string; target: string;
  expected: string; actual: string; code: string; nextAction: string };
export type HubLogRecord = HubEvent & { sequence: number; timestamp: number };
type History = { records: HubLogRecord[]; issue: string | null };
export const validRetentionDays = (value: unknown): value is number => Number.isInteger(value)
  && Number(value) >= 1 && Number(value) <= 0xffffffff;
export const defaultRetentionDays = 30;
export function formatHubRecord(record: HubLogRecord) {
  return `${new Date(record.timestamp).toISOString()} #${record.sequence} ${record.component}/${record.operation}`
    + `${record.runner ? ` runner=${record.runner}` : ''}${record.target ? ` target=${record.target}` : ''}`
    + ` expected=${record.expected} actual=${record.actual} code=${record.code} next=${record.nextAction}`;
}

/** One queue owns restore/append/prune; subscribers are presentation only. */
export class HubLog {
  private listeners = new Set<() => void>();
  private records: readonly HubLogRecord[] = [];
  private queue: Promise<void> = Promise.resolve();
  private started = false;
  private revision = 0;
  private faulted = false;
  issue = '';
  pending: readonly HubEvent[] = [];
  loading = true;
  constructor(private days: number) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getSnapshot = () => this.revision;
  get history() { return this.records; }
  private changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  private schedule(event?: HubEvent) {
    this.queue = this.queue.then(async () => {
      if (this.faulted) return;
      try {
        const history = await invoke<History>('hub_log', { request: { retentionDays: this.days, event: event ?? null } });
        this.records = history.records;
        this.issue = history.issue ?? '';
        this.faulted = !!history.issue;
        if (event && !this.faulted) this.pending = this.pending.filter(item => item !== event);
      } catch (reason) {
        this.issue = typeof reason === 'string' && /^HUB_LOG_[A-Z_]+$/.test(reason) ? reason : 'HUB_LOG_UNAVAILABLE';
        this.faulted = true;
      } finally { this.loading = false; this.changed(); }
    });
    return this.queue;
  }
  start() { if (!this.started) { this.started = true; void this.schedule(); } return this.queue; }
  record(event: HubEvent) {
    this.start();
    this.pending = [...this.pending, event]; this.changed();
    return this.schedule(event);
  }
  retention(days: number) { if (!validRetentionDays(days)) return; this.days = days; this.start(); return this.schedule(); }
  prune() { this.start(); return this.schedule(); }
  settled() { return this.queue; }
}
