import { msg, errorText, HubError, type HubText } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import type { ReferenceAdmission, ReferenceRequest, ReferenceSnapshot } from './referenceSelection';
import { RunnerImages } from './runnerImages';
import { RunnerConfigService } from './RunnerConfigService';
import { RunnerWork } from './runnerWork';
import { RunnerBrief } from './RunnerBrief';
import { RunnerTypedRun } from './RunnerTypedRun';
import { supportsRun, type RunRequest } from './runnerRunContract';
import { RunnerRecovery } from './RunnerRecovery';
import type { FeatureSnapshot, FeatureAdmission, InteractionRequest } from './runnerConfigContract';

// Hub observation and delivery policy; native FIFO deadlines remain native-owned.
// Python str.isspace(), including its extra information separators and excluding BOM.
const runnerWhitespace = /[\t-\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
function runnerCommandCandidate(text: string) {
  let start = 0;
  while (start < text.length && runnerWhitespace.test(text[start])) start++;
  return text.slice(start);
}
export function isRunnerCommand(text: string) { return runnerCommandCandidate(text).startsWith('/'); }
export function typedRunArguments(text: string) {
  const candidate = runnerCommandCandidate(text);
  // Match the canonical slash parser: consume one separator, preserve the full argument.
  if (candidate === '/run') return '';
  if (candidate.length > 4 && candidate.startsWith('/run') && runnerWhitespace.test(candidate[4])) return candidate.slice(5);
}

export const controlTiming = Object.freeze({ pollMs: 500, freshnessMs: 2500,
  connectMs: 35000, refreshMs: 5000, completionMs: 65000, settleMs: 50 });
// Matches the native clipboard staging security ceiling, not image discovery capacity.
export const clipboardMaxBytes = 64 * 1024 * 1024;

export type RunnerCommand = {
  id: string; text: string; aliases: string[]; parent_id: string | null;
  visible: boolean; enabled: boolean; disabled_reason: string; description: string; children: RunnerCommand[];
};
export type IssueRunUserAction = {
  schema_version: 'issue-run-user-action-v1'; status: 'required' | 'not_required' | 'unknown';
  issue_run_id: string; state_revision: number | null;
  requirements: { kind: 'clarification' | 'approval' | 'discussion' | 'dialogue' | 'human_request'; request_key: string; request_version: string }[];
};
export type RunnerObservation = {
  configured_startup_agent_id?: 'codex' | 'claude' | 'none' | null;
  issue_run_user_action?: IssueRunUserAction | null;
  issue_run_execution?: {
    schema_version: 'issue-run-execution-v1'; status: 'running' | 'idle' | 'unknown' | 'unsupported';
    issue_run_id: string; state_revision: number | null;
    interpreter: { invocation_id: string; launch_generation: number; thread_id: string;
      turn_id: string; instance_id: string } | null;
  };
  run_mode: string;
  target: { binding_state: string; owner: string; project: string };
  context_location?: { kind: 'direct_root'; path: string }
    | ({ kind: 'target'; label: string } & RunnerObservation['target']) | { kind: 'unbound' };
  selection: { agent_id?: string; account: string; model: string; reasoning_effort: string; service_tier: string; source: string;
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
  observationFailure?: { requestId: number; status: string; phase: string | null; code: string | null } | null;
  observationSerial?: number; observationAgeMs?: number | null; references?: ReferenceSnapshot; clipboardStaging?: boolean;
  generatedImagesSupported?: boolean; presentationSupported?: boolean; presentationGeneration?: number; features?: FeatureSnapshot };

export type CommandAttempt = { admission: FeatureAdmission; result?: ControlResult;
  state: 'pending' | 'completed' | 'not-sent' | 'unknown' };

export class RunnerControl {
  readonly images: RunnerImages;
  readonly config: RunnerConfigService;
  readonly work: RunnerWork;
  readonly brief: RunnerBrief;
  readonly typedRun: RunnerTypedRun;
  readonly recovery: RunnerRecovery;
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
  constructor(private readonly changed: () => boolean | void) {
    const run = (id: string, request: RunRequest) =>
      invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'run', request } });
    this.typedRun = new RunnerTypedRun(() => ({ session: this.id, snapshot: this.snapshot }),
      run, controlTiming.completionMs, changed);
    this.recovery = new RunnerRecovery(undefined, false, {
      completionMs: controlTiming.completionMs,
      observeMs: controlTiming.refreshMs,
      restoreMode: mode => this.observationFresh && this.snapshot.observation?.run_mode === mode
        ? Promise.resolve(true) : this.config.restoreMode(mode),
      submit: request => invoke<FeatureAdmission>('runner_feature', { id: this.id, request: { feature: 'recovery', request } }),
    }, changed);
    this.brief = new RunnerBrief({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: (lease, statusOnly) => !this.stopped && !this.tabClosing && this.snapshot.state === 'ready'
        && (statusOnly || !this.otherControlBusyExceptAttachments && !this.assignmentLocked)
        && (!this.attachmentLease || this.attachmentLease === lease),
      stage: (id, body) => invoke<FeatureAdmission>('runner_feature', { id,
        request: { feature: 'brief', request: { operation: 'brief.stage', api_version: 1, body } } }),
      run,
      completionMs: controlTiming.completionMs,
      pollMs: controlTiming.pollMs,
    }, changed);
    this.images = new RunnerImages(changed);
    this.config = new RunnerConfigService({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: () => !this.stopped && !this.tabClosing && !this.brief.busy && !this.brief.blocked
        && this.snapshot.state === 'ready' && !this.attachmentLocked && !this.otherControlBusyWithoutRecovery
        && (!this.recovery.busy || this.config.modeRestorationActive),
      backgroundAvailable: () => this.observationFresh && !this.busy && !this.work.busy
        && !this.brief.blocked && !this.images.busy
        && !this.snapshot.features?.results.some(result => ['sending', 'queued', 'pending-interaction'].includes(result.state)),
      submit: (id, request) => invoke<FeatureAdmission>('runner_feature', { id, request: { feature: 'session_config', request } }),
    }, changed);
    this.work = new RunnerWork({
      identity: () => this.id && this.snapshot.features
        ? { session: this.id, generation: this.snapshot.features.generation } : undefined,
      available: (operation, lease) => !this.stopped && (!this.tabClosing || operation === 'work.list') && this.snapshot.state === 'ready'
        && this.snapshot.observation?.selection.agent_id !== 'none'
        && !this.recovery.busy
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
  async fresh(reuseCurrent = false) {
    const after = this.snapshot.observationSerial ?? 0;
    const deadline = performance.now() + (this.snapshot.state === 'connecting' ? controlTiming.connectMs : controlTiming.refreshMs);
    while (!this.stopped && performance.now() < deadline) {
      if (this.snapshot.state === 'disconnected') break;
      if (this.observationFresh && !this.work.busy && !this.config.busy
        && (reuseCurrent || (this.snapshot.observationSerial ?? 0) > after)) return this.snapshot;
      await new Promise(resolve => setTimeout(resolve, controlTiming.settleMs));
    }
    throw new HubError(this.snapshot.detail || msg('runtime.control.freshUnavailable'));
  }
  get observationFresh() {
    return this.snapshot.state === 'ready' && !!this.snapshot.observation && typeof this.snapshot.observationAgeMs === 'number'
      && this.snapshot.observationAgeMs + performance.now() - this.receivedAt < controlTiming.freshnessMs;
  }
  private async refresh() {
    if (this.stopped || !this.id) return;
    try {
      const snapshot = await invoke<ControlSnapshot>('runner_observe', { id: this.id });
      if (this.stopped) return;
      if (snapshot.state === 'disconnected') {
        this.stop(snapshot.detail, snapshot);
        return;
      }
      this.snapshot = snapshot;
      this.receivedAt = performance.now();
      this.observeCommand();
      this.typedRun.observe();
      this.brief.observe(snapshot);
      const observation = snapshot.observation;
      this.config.observe(this.id, snapshot.state, snapshot.features, observation?.selection.agent_id,
        observation?.selection.account, observation && JSON.stringify([observation.selection, observation.run_mode,
          observation.target, observation.context_location, observation.attention.account_setup_required]));
      const recoveryChange = JSON.stringify([observation?.run_mode, observation?.execution, observation?.target,
        snapshot.results.at(-1)?.id, this.config.latestApplication?.receipt.id,
        this.work.current?.work?.event_id]);
      this.recovery.observe(snapshot.features, this.observationFresh && !this.tabClosing,
        !this.assignmentLocked && !this.attachmentLocked && !this.otherControlBusyWithoutRecovery
          && !snapshot.observation?.attention.foreground_interaction_active
          && !this.config.busy && !this.work.busy && !this.brief.busy,
        observation?.run_mode, recoveryChange,
        observation?.attention.foreground_interaction_active || observation?.attention.account_setup_required);
      this.work.observe(this.id, snapshot.state, snapshot.features, snapshot.observation?.run_mode);
      this.images.observe(snapshot.generatedImagesSupported === true, snapshot.state === 'ready',
        this.busy || !!snapshot.observation?.attention.foreground_interaction_active);
      this.receivedAt = performance.now();
      this.changed();
      this.config.refreshOptions();
      const foreground = this.assignmentLocked || this.attachmentLocked || this.sending || this.work.writing
        || this.brief.busy || this.typedRun.pending;
      this.timer = setTimeout(() => void this.refresh(), foreground ? controlTiming.settleMs : controlTiming.pollMs);
    } catch (reason) { if (!this.stopped) this.stop(errorText(reason)); }
  }
  get pending() { return this.recovery.busy || this.controlBusy || this.config.busy || this.work.writing || this.brief.busy; }
  get busy() { return this.tabClosing || this.pending; }
  private get controlBusy() {
    return this.assignmentLocked || this.otherControlBusy;
  }
  private get otherControlBusy() {
    return this.attachmentLocked || this.otherControlBusyExceptAttachments;
  }
  private get otherControlBusyExceptAttachments() {
    return this.recovery.busy || this.otherControlBusyWithoutRecovery;
  }
  private get otherControlBusyWithoutRecovery() {
    return !!this.snapshot.observation?.attention.foreground_interaction_active
      || this.sending || this.commandUnresolved || this.typedRun.pending || this.typedRun.uncertain || this.referenceAdmissions > 0
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
  private commandSession(text: string) {
    if (this.stopped || !this.id || this.snapshot.state !== 'ready') throw new HubError(msg('runtime.control.unavailable'));
    if (this.busy) throw new HubError(msg('runtime.control.finishPending'));
    if (/[\x00-\x08\n\r\x0e-\x1b\x7f-\x84\x86-\x9f]/.test(text)) throw new HubError(msg('runtime.control.unavailable'));
    return this.id;
  }
  runTyped(draft: string, text: string) {
    const session = this.commandSession(draft);
    const features = this.snapshot.features;
    if (this.snapshot.observation?.run_mode !== 'issue-run' || !commandNamed(this.snapshot, '/run')
      || !features || !supportsRun(features.run)) throw new HubError(msg('runtime.control.unavailable'));
    // Runner applies the live Run gate, including its fresh IssueRun text admission.
    return this.typedRun.submit({ session, generation: features.generation }, draft, text);
  }
  async command(text: string) {
    const id = this.commandSession(text);
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
      const admission = await invoke<FeatureAdmission>('runner_command', { id, command: text });
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
  async interaction(request: InteractionRequest) {
    const id = this.id, generation = this.snapshot.features?.generation;
    if (this.stopped || this.tabClosing || !id || !generation || !this.snapshot.features?.interaction)
      return { state: 'not-sent', code: 'INTERACTION_UNAVAILABLE', reply: undefined };
    const unavailable = { state: 'outcome-unknown' as const, detail: 'INTERACTION_RECEIPT_UNAVAILABLE' };
    const admission = await invoke<FeatureAdmission>('runner_feature', {
      id, request: { feature: 'interaction', request: { ...request, api_version: 1 } },
    }).catch(() => unavailable);
    if (admission.state !== 'submitted') return { state: admission.state, code: admission.detail, reply: undefined };
    const deadline = performance.now() + controlTiming.completionMs;
    while (!this.stopped && this.id === id && admission.generation === generation
      && this.snapshot.features?.generation === generation && this.snapshot.state === 'ready' && performance.now() < deadline) {
      const receipt = this.snapshot.features.results.find(r => r.id === admission.id
        && r.feature === 'interaction' && r.operation === request.operation);
      if (receipt && (receipt.phase === 'completed' || ['rejected', 'failure', 'outcome-unknown', 'not-sent'].includes(receipt.state)))
        return receipt;
      await new Promise(resolve => setTimeout(resolve, controlTiming.settleMs));
    }
    return { state: unavailable.state, code: unavailable.detail, reply: undefined };
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
    const path = await invoke<string>('runner_stage_clipboard', { id, png: Array.from(png) });
    return { path, sessionId: id };
  }
  async reference(request: ReferenceRequest, owningSession?: string, lease?: symbol): Promise<ReferenceAdmission> {
    const id = this.id;
    if (this.tabClosing && request.operation !== 'references.list')
      throw new HubError(msg('tabs.closing'));
    if (this.recovery.busy && request.operation !== 'references.list')
      throw new HubError(msg('runtime.control.finishPending'));
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
    this.observeCommand();
    this.typedRun.observe();
    this.brief.observe(this.snapshot);
    if (this.id) this.config.observe(this.id, 'disconnected', this.snapshot.features);
    this.config.close();
    if (this.id) this.work.observe(this.id, 'disconnected', this.snapshot.features);
    this.recovery.close();
    this.work.close();
    this.changed();
  }
}

export function flattenCommands(commands: RunnerCommand[]): RunnerCommand[] {
  return commands.flatMap(command => [command, ...flattenCommands(command.children)]);
}
export function commandNamed(snapshot: ControlSnapshot, text: string) {
  return flattenCommands(snapshot.observation?.commands ?? []).find(command => command.text === text && command.visible);
}
