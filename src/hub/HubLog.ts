import { invoke } from '@tauri-apps/api/core';
import { i18n, t, type MessageKey } from './i18n';

export type HubEvent = { component: string; operation: string; runner: string; target: string;
  expected: string; actual: string; code: string; nextAction: string };
export type HubLogRecord = HubEvent & { sequence: number; timestamp: number };
const eventLabels: Record<string, MessageKey> = {
  'spare-prepared': 'hubLog.events.sparePrepared', 'spare-promoted': 'hubLog.events.sparePromoted',
  'spare-failed': 'hubLog.events.spareFailed', 'runner-restarted': 'hubLog.events.restarted',
  'runner-shutdown': 'hubLog.events.shutdown', 'runner-restart-failed': 'hubLog.events.restartFailed',
  'runner-lifecycle': 'hubLog.events.lifecycle', connection: 'hubLog.events.connection',
  'work-admitted': 'hubLog.events.admitted', 'work-started': 'hubLog.events.started',
  'work-outcome': 'hubLog.events.work', 'work-submission': 'hubLog.events.submission',
  'configuration-apply': 'hubLog.events.settings',
};
const outcomeLabels: Record<string, MessageKey> = {
  succeeded: 'hubLog.outcomes.succeeded', failed: 'hubLog.outcomes.failed',
  applied: 'hubLog.outcomes.applied', partial: 'hubLog.outcomes.partial',
  unknown: 'hubLog.outcomes.unknown', incomplete: 'hubLog.outcomes.incomplete',
  interrupted: 'hubLog.outcomes.interrupted', rejected: 'hubLog.outcomes.rejected',
  failure: 'hubLog.outcomes.failure', 'outcome-unknown': 'hubLog.outcomes.unknown',
  'not-sent': 'hubLog.outcomes.notSent', ready: 'hubLog.outcomes.ready',
  disconnected: 'hubLog.outcomes.disconnected', running: 'hubLog.outcomes.running', exited: 'hubLog.outcomes.exited',
};
type History = { records: HubLogRecord[]; issue: string | null };
export const validRetentionDays = (value: unknown): value is number => Number.isInteger(value)
  && Number(value) >= 1 && Number(value) <= 0xffffffff;
export const defaultRetentionDays = 30;
export function formatHubTimestamp(timestamp: number) {
  const date = new Date(timestamp), pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatHubRecord(record: HubEvent) {
  const modern = ['system', 'task', 'settings'].includes(record.component) && record.expected === 'confirmed-outcome';
  const category = record.component === 'settings' || record.component === 'configuration' ? 'settings'
    : record.component === 'task' || record.component === 'work' ? 'task' : 'system';
  const label = eventLabels[record.operation];
  const outcome = outcomeLabels[record.actual] ?? 'hubLog.outcomes.unknown';
  const contextual = ['runner-lifecycle', 'connection', 'work-outcome', 'work-submission', 'configuration-apply'].includes(record.operation);
  let message = modern && label ? t(label) : t('hubLog.events.other');
  if (modern && contextual) message += ` · ${t(outcome)}`;
  if (!modern) {
    const component = ['assignment', 'allocation', 'restoration', 'runner', 'connection', 'configuration', 'work', 'delivery',
      'system', 'task', 'settings'].includes(record.component) ? record.component : '';
    const identity = record.operation.split('/')[0];
    const operation = ['observe', 'command', 'apply', 'session_config.inspect', 'session_config.plan', 'session_config.apply'].includes(identity)
      || Object.hasOwn(eventLabels, identity)
      || (/^(entry|spare|workspace|runner|control|work)\.[a-zA-Z.]+$/.test(identity) && i18n.exists(identity)) ? identity : '';
    const context = [component, operation].filter(Boolean).join(' / ');
    const description: Record<string, MessageKey> = { connection: 'hubLog.events.connection', runner: 'hubLog.events.lifecycle',
      configuration: 'hubLog.events.settings', work: 'hubLog.events.work', delivery: 'hubLog.events.submission' };
    if (context) message += ` · ${Object.hasOwn(description, component) ? t(description[component]) + ' · ' : ''}${context}`;
    message += ` · ${t('hubLog.historical')}`;
  }
  const runner = /^[\p{L}\p{N}_. -]{1,256}$/u.test(record.runner) ? record.runner : '';
  if (runner) message = modern && record.operation === 'spare-promoted' ? t('hubLog.promoted', { runner }) : `${runner} · ${message}`;
  const target = /^(Project|Workspace)\/[\p{L}\p{N}_. /-]{1,256}$/u.test(record.target) ? record.target : '';
  if (target) message += ` · ${target}`;
  const tone = !modern ? 'normal' : ['failed', 'failure'].includes(record.actual) ? 'failure'
    : ['succeeded', 'applied'].includes(record.actual) ? 'success'
    : (contextual && !outcomeLabels[record.actual]) || ['unknown', 'outcome-unknown', 'partial', 'incomplete', 'interrupted', 'rejected', 'not-sent', 'disconnected'].includes(record.actual) ? 'warning' : 'normal';
  const categoryKey = category === 'system' ? 'hubLog.categories.system'
    : category === 'task' ? 'hubLog.categories.task' : 'hubLog.categories.settings';
  return { category: t(categoryKey), message, tone };
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
