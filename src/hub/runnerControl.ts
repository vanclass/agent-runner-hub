import { invoke } from '@tauri-apps/api/core';
import type { ReferenceAdmission, ReferenceRequest, ReferenceSnapshot } from './referenceSelection';

export type RunnerCommand = {
  id: string; text: string; aliases: string[]; parent_id: string | null;
  visible: boolean; enabled: boolean; disabled_reason: string; description: string; children: RunnerCommand[];
};
export type RunnerObservation = {
  run_mode: string;
  target: { binding_state: string; owner: string; project: string };
  selection: { account: string; model: string; reasoning_effort: string; service_tier: string; source: string;
    next_model: string; next_reasoning_effort: string; next_service_tier: string };
  execution: { lifecycle_state: string; owned_execution_alive: boolean; workflow_kind: string };
  attention: { foreground_interaction_active: boolean; restart_confirmation_required: boolean;
    termination_confirmation_active: boolean; account_setup_required: boolean; awaiting_user_command_reason: string;
    suspension_status: string; suspension_reason: string };
  commands: RunnerCommand[];
};
export type ControlResult = { id: number; command: string;
  state: 'sending' | 'queued' | 'pending-interaction' | 'accepted' | 'rejected' | 'failure' | 'outcome-unknown'; code?: string;
  ownerStatus?: string | null; changed?: boolean | number | null; settingsChangeCount?: boolean | number | null };
export type ControlSnapshot = { state: 'connecting' | 'ready' | 'disconnected';
  observation?: RunnerObservation; results: ControlResult[]; detail?: string;
  observationSerial?: number; observationAgeMs?: number | null; references?: ReferenceSnapshot };

export class RunnerControl {
  snapshot: ControlSnapshot = { state: 'connecting', results: [] };
  sending = false;
  assignmentLocked = false;
  receivedAt = 0;
  private admissionAfter = 0;
  hidden = new Set<string>();
  order: string[] = [];
  private id?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private referenceAdmissions = 0;
  constructor(private readonly changed: () => void) {}
  start(id: string) { this.id = id; void this.refresh(); }
  async fresh() {
    const after = this.snapshot.observationSerial ?? 0;
    const deadline = performance.now() + (this.snapshot.state === 'connecting' ? 35000 : 5000);
    while (!this.stopped && performance.now() < deadline) {
      if (this.snapshot.state === 'disconnected') break;
      if (this.snapshot.state === 'ready' && (this.snapshot.observationSerial ?? 0) > after
        && this.observationFresh) return this.snapshot;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(this.snapshot.detail || 'Fresh authenticated Runner readiness is unavailable. Instruction unsent.');
  }
  get observationFresh() {
    return this.snapshot.state === 'ready' && typeof this.snapshot.observationAgeMs === 'number'
      && this.snapshot.observationAgeMs + performance.now() - this.receivedAt < 2500;
  }
  private async refresh() {
    if (this.stopped || !this.id) return;
    try {
      const snapshot = await invoke<ControlSnapshot>('runner_observe', { id: this.id });
      if (this.stopped) return;
      this.snapshot = snapshot;
      this.receivedAt = performance.now();
      if (snapshot.results.some(result => result.id > this.admissionAfter)) this.sending = false;
      this.changed();
      if (snapshot.state === 'disconnected') return;
      this.timer = setTimeout(() => void this.refresh(), 500);
    } catch (reason) { if (!this.stopped) this.stop(String(reason)); }
  }
  get busy() {
    return this.assignmentLocked || this.sending || this.referenceAdmissions > 0
      || this.snapshot.results.some(result => ['sending', 'queued', 'pending-interaction'].includes(result.state))
      || (this.snapshot.references?.results.some(result => ['sending', 'queued', 'pending-interaction'].includes(result.state)) ?? false);
  }
  shortcuts() {
    const canonical = flattenCommands(this.snapshot.observation?.commands ?? [])
      .filter(command => command.visible && command.text.startsWith('/'));
    return [...this.order.map(text => canonical.find(command => command.text === text)).filter((item): item is RunnerCommand => !!item),
      ...canonical.filter(command => !this.order.includes(command.text))];
  }
  show(text: string, visible: boolean) {
    if (visible) this.hidden.delete(text); else this.hidden.add(text);
    this.changed();
  }
  move(text: string, offset: number) {
    const ordered = this.shortcuts().map(command => command.text);
    const index = ordered.indexOf(text), next = index + offset;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    this.order = ordered; this.changed();
  }
  async command(text: string) {
    if (this.stopped || !this.id || this.snapshot.state !== 'ready') throw new Error('Runner control is unavailable.');
    if (this.busy) throw new Error('Finish the pending Runner interaction in its terminal.');
    this.sending = true; this.changed();
    this.admissionAfter = Math.max(0, ...this.snapshot.results.map(result => result.id));
    try { await invoke<void>('runner_command', { id: this.id, command: text }); }
    catch (reason) { this.sending = false; this.changed(); throw reason; }
  }
  async reference(request: ReferenceRequest) {
    const id = this.id;
    if (this.stopped || !id || this.snapshot.state !== 'ready' || !this.snapshot.references?.capability)
      throw new Error('Authenticated reference capability is unavailable.');
    if (this.assignmentLocked && request.operation !== 'references.list')
      throw new Error('Single Entry holds this Runner.');
    this.referenceAdmissions++; this.changed();
    try { return await invoke<ReferenceAdmission>('runner_reference', { id, request }); }
    finally { this.referenceAdmissions--; this.changed(); }
  }
  stop(detail = 'Runner process exited', finalSnapshot?: ControlSnapshot) {
    this.stopped = true;
    this.sending = false;
    clearTimeout(this.timer);
    const final = finalSnapshot ?? this.snapshot;
    const message = final.detail ?? (final.observation ? detail
      : `${detail}. This installation did not establish verified Runner control; check local-control launch compatibility.`);
    this.snapshot = { ...final, state: 'disconnected', detail: message,
      references: final.references && { ...final.references,
        results: final.references.results.map(result => ['sending', 'queued', 'pending-interaction'].includes(result.state)
          ? { ...result, state: 'outcome-unknown' } : result) },
      results: final.results.map(result => ['sending', 'queued', 'pending-interaction'].includes(result.state)
        ? { ...result, state: 'outcome-unknown' } : result) };
    this.changed();
  }
}

export function flattenCommands(commands: RunnerCommand[]): RunnerCommand[] {
  return commands.flatMap(command => [command, ...flattenCommands(command.children)]);
}
export function commandNamed(snapshot: ControlSnapshot, text: string) {
  return flattenCommands(snapshot.observation?.commands ?? []).find(command => command.text === text && command.visible);
}
