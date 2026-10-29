import { msg, errorText, HubError, type HubText } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import type { ReferenceAdmission, ReferenceRequest, ReferenceSnapshot } from './referenceSelection';
import { RunnerImages } from './runnerImages';
import { RunnerConfigService } from './RunnerConfigService';
import { RunnerWork } from './runnerWork';
import type { FeatureSnapshot, FeatureAdmission } from './runnerConfigContract';

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
  observation?: RunnerObservation; results: ControlResult[]; detail?: HubText;
  observationSerial?: number; observationAgeMs?: number | null; references?: ReferenceSnapshot; clipboardStaging?: boolean;
  generatedImagesSupported?: boolean; features?: FeatureSnapshot };

export class RunnerControl {
  readonly images: RunnerImages;
  readonly config: RunnerConfigService;
  readonly work: RunnerWork;
  snapshot: ControlSnapshot = { state: 'connecting', results: [] };
  sending = false;
  assignmentLocked = false;
  tabClosing = false;
  receivedAt = 0;
  private admissionAfter = 0;
  hidden = new Set<string>();
  order: string[] = [];
  private id?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private referenceAdmissions = 0;
  private attachmentLease?: symbol;
  get sessionId() { return this.id; }
  get attachmentLocked() { return !!this.attachmentLease; }
  ownsAttachments(lease?: symbol) { return !!lease && lease === this.attachmentLease; }
  reserveAttachments() {
    if (this.stopped || this.busy || this.snapshot.state !== 'ready')
      throw new HubError(msg('runtime.control.finishAttachments'));
    this.attachmentLease = Symbol('attachment submission');
    this.changed();
    return this.attachmentLease;
  }
  releaseAttachments(lease: symbol) {
    if (this.attachmentLease === lease) { this.attachmentLease = undefined; this.changed(); }
  }
  constructor(private readonly changed: () => void) {
    this.images = new RunnerImages(changed);
    this.config = new RunnerConfigService({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: () => !this.stopped && !this.tabClosing && this.snapshot.state === 'ready' && !this.otherControlBusy,
      submit: (id, request) => invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'session_config', request } }),
    }, changed);
    this.work = new RunnerWork({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: (operation, lease) => !this.stopped && !this.tabClosing && this.snapshot.state === 'ready'
        && !(['work.status', 'work.observe'].includes(operation) || operation === 'work.submit' && lease && lease === this.attachmentLease
          ? this.otherControlBusyExceptAttachments : this.otherControlBusy)
        && (operation !== 'work.list' || !this.assignmentLocked)
        && !this.config.busy && !this.images.busy && (operation !== 'work.submit' || !this.config.uncertain),
      submit: (id, request) => invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'work', request } }),
    }, changed);
  }
  start(id: string) { this.id = id; this.images.start(id); void this.refresh(); }
  async fresh() {
    const after = this.snapshot.observationSerial ?? 0;
    const deadline = performance.now() + (this.snapshot.state === 'connecting' ? 35000 : 5000);
    while (!this.stopped && performance.now() < deadline) {
      if (this.snapshot.state === 'disconnected') break;
      if (this.snapshot.state === 'ready' && (this.snapshot.observationSerial ?? 0) > after
        && this.observationFresh) return this.snapshot;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new HubError(this.snapshot.detail || msg('runtime.control.freshUnavailable'));
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
      this.config.observe(this.id, snapshot.state, snapshot.features);
      this.work.observe(this.id, snapshot.state, snapshot.features);
      this.images.observe(snapshot.generatedImagesSupported === true, snapshot.state === 'ready',
        this.busy || !!snapshot.observation?.attention.foreground_interaction_active);
      this.receivedAt = performance.now();
      if (snapshot.results.some(result => result.id > this.admissionAfter)) this.sending = false;
      this.changed();
      if (snapshot.state === 'disconnected') return;
      this.timer = setTimeout(() => void this.refresh(), 500);
    } catch (reason) { if (!this.stopped) this.stop(errorText(reason)); }
  }
  get pending() { return this.controlBusy || this.config.busy || this.work.writing; }
  get busy() { return this.tabClosing || this.pending; }
  private get controlBusy() {
    return this.assignmentLocked || this.otherControlBusy;
  }
  private get otherControlBusy() {
    return this.attachmentLocked || this.otherControlBusyExceptAttachments;
  }
  private get otherControlBusyExceptAttachments() {
    return this.sending || this.referenceAdmissions > 0
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
    if (this.stopped || !this.id || this.snapshot.state !== 'ready') throw new HubError(msg('runtime.control.unavailable'));
    if (this.busy) throw new HubError(msg('runtime.control.finishPending'));
    this.sending = true; this.changed();
    this.admissionAfter = Math.max(0, ...this.snapshot.results.map(result => result.id));
    try { await invoke<void>('runner_command', { id: this.id, command: text }); }
    catch (reason) { this.sending = false; this.changed(); throw reason; }
  }
  async stageImage(blob: Blob, lease?: symbol) {
    const id = this.id;
    if (this.stopped || !id || this.otherControlBusyExceptAttachments || this.assignmentLocked
      || this.attachmentLease !== lease || !this.snapshot.clipboardStaging || !this.snapshot.references?.capability)
      throw new HubError(msg('runtime.control.clipboardRequires'));
    if (blob.type !== 'image/png' || !blob.size || blob.size > 64 * 1024 * 1024)
      throw new HubError(msg('runtime.control.clipboardUnsupported'));
    const png = new Uint8Array(await blob.arrayBuffer());
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte))
      throw new HubError(msg('runtime.control.clipboardInvalid'));
    if (this.stopped || id !== this.id || this.otherControlBusyExceptAttachments || this.assignmentLocked
      || this.attachmentLease !== lease || this.snapshot.state !== 'ready')
      throw new HubError(msg('runtime.control.ownerUnavailable'));
    const thumbnail = await clipboardThumbnail(blob);
    const path = await invoke<string>('runner_stage_clipboard', { id, png: Array.from(png) });
    return { path, sessionId: id, thumbnail };
  }
  async reference(request: ReferenceRequest, owningSession?: string, lease?: symbol): Promise<ReferenceAdmission> {
    const id = this.id;
    if (this.tabClosing && request.operation !== 'references.list')
      throw new HubError(msg('tabs.closing'));
    if (owningSession && owningSession !== id)
      return { state: 'failure', detail: msg('runtime.control.ownerChanged') };
    if (this.stopped || !id || this.snapshot.state !== 'ready' || !this.snapshot.references?.capability)
      throw new HubError(msg('runtime.control.referenceUnavailable'));
    if (this.assignmentLocked && request.operation !== 'references.list')
      throw new HubError(msg('runtime.control.entryHolds'));
    if (this.attachmentLease && this.attachmentLease !== lease)
      throw new HubError(msg('runtime.control.attachmentsLocked'));
    if (request.operation === 'references.remove' && !this.snapshot.references?.removalCapability)
      return { state: 'failure', detail: msg('runtime.control.manualRemoval') };
    this.referenceAdmissions++; this.changed();
    try { return await invoke<ReferenceAdmission>('runner_reference', { id, request }); }
    finally { this.referenceAdmissions--; this.changed(); }
  }
  stop(detail: HubText = msg('runtime.control.processExited'), finalSnapshot?: ControlSnapshot) {
    this.stopped = true;
    this.images.stop();
    this.sending = false;
    clearTimeout(this.timer);
    const final = finalSnapshot ?? this.snapshot;
    const message = final.detail ?? (final.observation ? detail
      : msg('runtime.control.compatibility', { detail }));
    this.snapshot = { ...final, state: 'disconnected', detail: message,
      references: final.references && { ...final.references,
        results: final.references.results.map(result => ['sending', 'queued', 'pending-interaction'].includes(result.state)
          ? { ...result, state: 'outcome-unknown' } : result) },
      results: final.results.map(result => ['sending', 'queued', 'pending-interaction'].includes(result.state)
        ? { ...result, state: 'outcome-unknown' } : result) };
    if (this.id) this.config.observe(this.id, 'disconnected', this.snapshot.features);
    this.config.close();
    if (this.id) this.work.observe(this.id, 'disconnected', this.snapshot.features);
    this.work.close();
    this.changed();
  }
}

async function clipboardThumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new HubError(msg('runtime.control.previewUnavailable'));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(thumbnail => {
      if (thumbnail && thumbnail.size <= 256 * 1024) resolve(thumbnail);
      else reject(new HubError(msg('runtime.control.previewTooLarge')));
    }, 'image/png'));
  } finally { bitmap.close(); }
}

export function flattenCommands(commands: RunnerCommand[]): RunnerCommand[] {
  return commands.flatMap(command => [command, ...flattenCommands(command.children)]);
}
export function commandNamed(snapshot: ControlSnapshot, text: string) {
  return flattenCommands(snapshot.observation?.commands ?? []).find(command => command.text === text && command.visible);
}
