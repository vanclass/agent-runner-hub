import { msg, errorText, HubError, type HubText } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import type { ReferenceAdmission, ReferenceRequest, ReferenceSnapshot } from './referenceSelection';
import { RunnerImages } from './runnerImages';
import { RunnerConfigService } from './RunnerConfigService';
import { RunnerWork } from './runnerWork';
import { RunnerBrief } from './RunnerBrief';
import { RunnerInteraction } from './RunnerInteraction';
import type { FeatureSnapshot, FeatureAdmission } from './runnerConfigContract';

// Hub observation and delivery policy; native FIFO deadlines remain native-owned.
// Python str.isspace(), including its extra information separators and excluding BOM.
const runnerWhitespace = /[\t-\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
function runnerCommandCandidate(text: string) {
  let start = 0;
  while (start < text.length && runnerWhitespace.test(text[start])) start++;
  return text.slice(start);
}
export function isRunnerCommand(text: string) { return runnerCommandCandidate(text).startsWith('/'); }

export const controlTiming = Object.freeze({ pollMs: 500, freshnessMs: 2500,
  connectMs: 35000, refreshMs: 5000, completionMs: 65000, settleMs: 50 });
// Matches the native clipboard staging security ceiling, not image discovery capacity.
export const clipboardMaxBytes = 64 * 1024 * 1024;

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
  phase?: string | null;
  state: 'sending' | 'queued' | 'pending-interaction' | 'accepted' | 'rejected' | 'failure' | 'outcome-unknown'; code?: string;
  ownerStatus?: string | null; changed?: boolean | number | null; settingsChangeCount?: boolean | number | null };
export type ControlSnapshot = { state: 'connecting' | 'ready' | 'disconnected';
  observation?: RunnerObservation; results: ControlResult[]; detail?: HubText;
  observationSerial?: number; observationAgeMs?: number | null; references?: ReferenceSnapshot; clipboardStaging?: boolean;
  generatedImagesSupported?: boolean; features?: FeatureSnapshot };

export type CommandAttempt = { admission: FeatureAdmission; result?: ControlResult;
  state: 'pending' | 'completed' | 'not-sent' | 'unknown' };

export class RunnerControl {
  readonly interaction: RunnerInteraction;
  readonly images: RunnerImages;
  readonly config: RunnerConfigService;
  readonly work: RunnerWork;
  readonly brief: RunnerBrief;
  snapshot: ControlSnapshot = { state: 'connecting', results: [] };
  sending = false;
  assignmentLocked = false;
  tabClosing = false;
  receivedAt = 0;
  private commandAttempt?: CommandAttempt;
  get commandPending() { return this.commandAttempt?.state === 'pending'; }
  get commandUnresolved() { return !!this.commandAttempt && ['pending', 'unknown'].includes(this.commandAttempt.state); }
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
    this.interaction = new RunnerInteraction((id, request) => invoke<FeatureAdmission>('runner_feature', {
      id, request: { feature: 'interaction', request },
    }), changed, controlTiming.completionMs);
    this.brief = new RunnerBrief({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: lease => !this.stopped && !this.tabClosing && this.snapshot.state === 'ready'
        && !this.otherControlBusyExceptAttachments && !this.assignmentLocked
        && (!this.attachmentLease || this.attachmentLease === lease),
      stage: (id, body) => invoke<FeatureAdmission>('runner_feature', { id,
        request: { feature: 'brief', request: { operation: 'brief.stage', api_version: 1, body } } }),
      run: (id, request) => invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'run', request } }),
      completionMs: controlTiming.completionMs,
      pollMs: controlTiming.pollMs,
    }, changed);
    this.images = new RunnerImages(changed);
    this.config = new RunnerConfigService({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: () => !this.stopped && !this.tabClosing && !this.brief.busy && !this.brief.blocked
        && this.snapshot.state === 'ready' && !this.otherControlBusy,
      submit: (id, request) => invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'session_config', request } }),
    }, changed);
    this.work = new RunnerWork({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: (operation, lease) => !this.stopped && (!this.tabClosing || operation === 'work.list') && this.snapshot.state === 'ready'
        && !this.brief.busy
        && !(['work.status', 'work.observe'].includes(operation) || operation === 'work.submit' && lease && lease === this.attachmentLease
          ? this.otherControlBusyExceptAttachments : this.otherControlBusy)
        && (operation !== 'work.list' || !this.assignmentLocked)
        && !this.config.busy && (!this.images.busy || this.tabClosing && operation === 'work.list')
        && (operation !== 'work.submit' || !this.config.uncertain),
      submit: (id, request) => invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'work', request } }),
    }, changed);
  }
  start(id: string) { this.id = id; this.images.start(id); void this.refresh(); }
  async fresh() {
    const after = this.snapshot.observationSerial ?? 0;
    const deadline = performance.now() + (this.snapshot.state === 'connecting' ? controlTiming.connectMs : controlTiming.refreshMs);
    while (!this.stopped && performance.now() < deadline) {
      if (this.snapshot.state === 'disconnected') break;
      if (this.snapshot.state === 'ready' && (this.snapshot.observationSerial ?? 0) > after
        && this.observationFresh) return this.snapshot;
      await new Promise(resolve => setTimeout(resolve, controlTiming.settleMs));
    }
    throw new HubError(this.snapshot.detail || msg('runtime.control.freshUnavailable'));
  }
  get observationFresh() {
    return this.snapshot.state === 'ready' && typeof this.snapshot.observationAgeMs === 'number'
      && this.snapshot.observationAgeMs + performance.now() - this.receivedAt < controlTiming.freshnessMs;
  }
  private async refresh() {
    if (this.stopped || !this.id) return;
    try {
      const snapshot = await invoke<ControlSnapshot>('runner_observe', { id: this.id });
      if (this.stopped) return;
      this.snapshot = snapshot;
      this.observeCommand();
      if (!this.tabClosing) this.interaction.observe(this.id, snapshot.state, snapshot.features);
      this.brief.observe(snapshot);
      this.config.observe(this.id, snapshot.state, snapshot.features);
      this.work.observe(this.id, snapshot.state, snapshot.features);
      this.images.observe(snapshot.generatedImagesSupported === true, snapshot.state === 'ready',
        this.busy || !!snapshot.observation?.attention.foreground_interaction_active);
      this.receivedAt = performance.now();
      this.changed();
      if (snapshot.state === 'disconnected') return;
      this.timer = setTimeout(() => void this.refresh(), controlTiming.pollMs);
    } catch (reason) { if (!this.stopped) this.stop(errorText(reason)); }
  }
  get pending() { return this.controlBusy || this.config.busy || this.work.writing || this.brief.busy; }
  get busy() { return this.tabClosing || this.pending; }
  private get controlBusy() {
    return this.assignmentLocked || this.otherControlBusy;
  }
  private get otherControlBusy() {
    return this.attachmentLocked || this.otherControlBusyExceptAttachments;
  }
  private get otherControlBusyExceptAttachments() {
    return this.interaction.writing || this.interaction.view?.state === 'active'
      || this.sending || this.commandUnresolved || this.referenceAdmissions > 0
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
    if (/[\x00-\x08\n\r\x0e-\x1b\x7f-\x84\x86-\x9f]/.test(text)) throw new HubError(msg('runtime.control.unavailable'));
    // Python str.isspace() boundaries used by Runner; match identity only, never arguments.
    const candidate = runnerCommandCandidate(text);
    const commands = flattenCommands(this.snapshot.observation?.commands ?? []);
    const matches = commands.flatMap(command => [command.text, ...command.aliases]
      .filter(name => name.startsWith('/') && candidate.startsWith(name)
        && (candidate.length === name.length || runnerWhitespace.test(candidate[name.length])))
      .map(name => ({ command, name })));
    const command = matches.sort((a, b) => b.name.length - a.name.length)[0]?.command;
    if (!command?.visible || !command.enabled) throw new HubError(msg('runtime.control.unavailable'));
    this.sending = true; this.changed();
    try {
      const admission = await invoke<FeatureAdmission>('runner_command', { id: this.id, command: text });
      const attempt: CommandAttempt = { admission, state: admission.state === 'submitted' ? 'pending'
        : admission.state === 'not-sent' ? 'not-sent' : 'unknown' };
      this.commandAttempt = attempt;
      this.sending = false;
      this.observeCommand(); this.changed();
      return attempt;
    }
    catch (reason) {
      const attempt: CommandAttempt = { admission: { state: 'outcome-unknown', detail: String(reason) }, state: 'unknown' };
      this.commandAttempt = attempt;
      this.sending = false; this.changed(); return attempt;
    }
  }
  private observeCommand() {
    const attempt = this.commandAttempt;
    if (!attempt || attempt.admission.state !== 'submitted') return;
    const id = attempt.admission.id;
    const result = this.snapshot.results.find(result => result.id === id);
    if (result) attempt.result = result;
    if (result?.phase === 'completed' && ['accepted', 'rejected', 'failure'].includes(result.state))
      attempt.state = 'completed';
    else if (result?.state === 'outcome-unknown' || this.snapshot.state === 'disconnected') attempt.state = 'unknown';
  }
  async stageImage(blob: Blob, lease?: symbol) {
    const id = this.id;
    if (this.stopped || !id || this.otherControlBusyExceptAttachments || this.assignmentLocked
      || this.attachmentLease !== lease || !this.snapshot.clipboardStaging || !this.snapshot.references?.capability)
      throw new HubError(msg('runtime.control.clipboardRequires'));
    if (blob.type !== 'image/png' || !blob.size || blob.size > clipboardMaxBytes)
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
    this.interaction.close();
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
    this.observeCommand();
    this.brief.observe(this.snapshot);
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
