import { record } from './runnerConfigContract';
import type { ControlSnapshot } from './runnerControl';

export type RunnerNotification = { topic: string; payload: Record<string, unknown> };
export type ControlUpdate = { kind: 'snapshot'; snapshot: ControlSnapshot }
  | { kind: 'notification'; notification: RunnerNotification };

export type CodexNotification = {
  execution_id: string; instance_id: string; launch_generation: number;
  thread_id: string; turn_id: string; provider_sequence: number;
  notification: { method: string; params: Record<string, unknown> };
};

function isCodexNotification(value: Record<string, unknown>): value is CodexNotification {
  return ['execution_id', 'instance_id', 'thread_id', 'turn_id'].every(key =>
    typeof value[key] === 'string' && value[key].length > 0)
    && ['launch_generation', 'provider_sequence'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) > 0)
    && record(value.notification) && typeof value.notification.method === 'string'
    && record(value.notification.params);
}

/** A session consumer boundary for observed Provider activity. */
export class RunnerProviderEvents {
  private listeners = new Set<(event: CodexNotification | undefined) => void>();
  covered = false;
  subscribe(listener: (event: CodexNotification | undefined) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  coverage(covered: boolean) {
    const lost = this.covered && !covered;
    this.covered = covered;
    if (lost) for (const listener of this.listeners) listener(undefined);
  }
  receive(payload: Record<string, unknown>) {
    if (isCodexNotification(payload)) for (const listener of this.listeners) listener(payload);
  }
  close() { this.coverage(false); this.listeners.clear(); }
}

// Native verifies wire identity and delivery sequence. Validate the IPC update shape here.
export function controlUpdate(value: unknown): ControlUpdate | undefined {
  if (!record(value)) return;
  if (value.kind === 'snapshot' && record(value.snapshot) && Array.isArray(value.snapshot.results)
    && ['connecting', 'ready', 'disconnected'].includes(String(value.snapshot.state)))
    return value as ControlUpdate;
  if (value.kind === 'notification' && record(value.notification)
    && typeof value.notification.topic === 'string' && record(value.notification.payload))
    return value as ControlUpdate;
}
