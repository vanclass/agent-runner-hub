import { msg, errorText, type HubText } from './i18n';
import { record, type FeatureAdmission, type FeatureSnapshot } from './runnerConfigContract';

export type InteractionAction = 'confirm' | 'select' | 'text' | 'back' | 'cancel';
export type InteractionView = { state: 'none' | 'unsupported'; code?: string } | {
  state: 'active'; interaction_id: string; kind: 'confirmation' | 'selection' | 'text'; prompt: string; context: string;
  actions: InteractionAction[]; choices: { choice_id: string; label: string; description: string; enabled: boolean; disabled_reason: string }[];
  text_input: { required: true; multiline: false } | null;
  consequences?: { text: string; role: string; details: string[] }[];
};
export type InteractionRequest = { operation: 'interaction.observe'; api_version: 1 }
  | { operation: 'interaction.respond'; api_version: 1; interaction_id: string; action: InteractionAction; choice_id?: string; text?: string };
export type InteractionCapability = { version: 1; operations: string[]; dispatch_boundary: 'foreground_input'; automatic_replay: false; lifetime: 'current_owner' };
export function validInteraction(v: unknown): v is InteractionView {
  if (!record(v)) return false;
  if (v.state === 'none' || v.state === 'unsupported') return !('prompt' in v) && !('interaction_id' in v)
    && (!('code' in v) || typeof v.code === 'string');
  if (v.state !== 'active' || typeof v.interaction_id !== 'string' || !v.interaction_id
    || typeof v.prompt !== 'string' || typeof v.context !== 'string' || !Array.isArray(v.choices) || !Array.isArray(v.actions)) return false;
  const primary = { confirmation: 'confirm', selection: 'select', text: 'text' }[String(v.kind)];
  if (!primary || !v.actions.length || new Set(v.actions).size !== v.actions.length
    || !v.actions.every(a => [primary, 'back', 'cancel'].includes(a))) return false;
  if (!v.choices.every(c => record(c) && typeof c.choice_id === 'string' && !!c.choice_id && typeof c.label === 'string'
    && typeof c.description === 'string' && typeof c.enabled === 'boolean' && typeof c.disabled_reason === 'string')
    || new Set(v.choices.map(c => c.choice_id)).size !== v.choices.length) return false;
  if (v.kind === 'text' ? v.choices.length || !record(v.text_input) || v.text_input.required !== true || v.text_input.multiline !== false
    : v.text_input !== null) return false;
  return v.kind !== 'confirmation' || Array.isArray(v.consequences) && v.consequences.every(c => record(c)
    && typeof c.text === 'string' && typeof c.role === 'string' && Array.isArray(c.details) && c.details.every(d => typeof d === 'string'));
}
export class RunnerInteraction {
  view?: InteractionView;
  detail?: HubText;
  state: 'connecting' | 'ready' | 'unsupported' | 'disconnected' = 'connecting';
  private identity?: { session: string; generation: number };
  private pending?: { request: InteractionRequest; id?: number; started: number };
  private retired = new Set<string>();
  private closed = false;
  get busy() { return !!this.pending; }
  get writing() { return this.pending?.request.operation === 'interaction.respond'; }
  constructor(private readonly transport: (session: string, request: InteractionRequest) => Promise<FeatureAdmission>,
    private readonly changed: () => void, private readonly completionMs: number) {}
  observe(session: string, state: string, features?: FeatureSnapshot) {
    if (this.closed) return;
    const generation = features?.generation;
    if (this.identity && (this.identity.session !== session || this.identity.generation !== generation)) {
      this.retire(); this.detail = msg('interaction.ownerChanged');
    }
    if (state !== 'ready') {
      if (this.pending?.request.operation === 'interaction.respond') {
        this.retired.add(this.pending.request.interaction_id); this.detail = msg('interaction.unknown');
      }
      this.pending = undefined; this.view = undefined;
      this.state = state === 'disconnected' ? 'disconnected' : 'connecting'; return;
    }
    this.identity ??= { session, generation: generation! };
    const cap = features?.interaction;
    if (!Number.isSafeInteger(generation) || !cap || cap.version !== 1 || cap.dispatch_boundary !== 'foreground_input'
      || cap.automatic_replay !== false || cap.lifetime !== 'current_owner' || !Array.isArray(cap.operations)
      || !['interaction.observe', 'interaction.respond'].every(op => cap.operations.includes(op))) {
      if (this.pending?.request.operation === 'interaction.respond') {
        this.retired.add(this.pending.request.interaction_id); this.detail = msg('interaction.unknown');
      }
      this.pending = undefined; this.view = undefined; this.state = 'unsupported'; return;
    }
    this.state = 'ready';
    const pending = this.pending;
    if (pending) {
      const result = features!.results.find(r => r.id === pending.id && r.feature === 'interaction' && r.operation === pending.request.operation);
      if (result && !['sending', 'queued', 'pending-interaction'].includes(result.state)) {
        this.pending = undefined;
        const reply = result.reply;
        const completed = result.phase === 'completed';
        if (pending.request.operation === 'interaction.observe') {
          if (result.state === 'accepted' && completed && record(reply) && reply.api_version === 1 && validInteraction(reply.interaction)) {
            this.view = reply.interaction;
            return;
          }
          this.view = undefined; this.detail = result.code || msg('interaction.unavailable');
          return;
        }
        const accepted = result.state === 'accepted' && completed && record(reply) && reply.api_version === 1
          && reply.input_status === 'accepted' && reply.outcome_unknown === false && reply.effect_status === 'awaiting_command_owner'
          && ['active', 'completed', 'cancelled'].includes(String(reply.interaction_status));
        const rejected = result.state === 'rejected' && record(reply) && (!completed
          || reply.input_status === 'not_accepted' && reply.outcome_unknown === false);
        if (accepted || !rejected) this.retired.add(pending.request.interaction_id);
        this.detail = accepted ? msg(reply.interaction_status === 'cancelled' ? 'interaction.cancelled' : 'interaction.accepted')
          : rejected ? msg('interaction.rejected', { code: result.code || result.state }) : msg('interaction.unknown');
        this.view = undefined;
      } else if (performance.now() - pending.started > this.completionMs) {
        if (pending.request.operation === 'interaction.respond') this.retired.add(pending.request.interaction_id);
        this.pending = undefined; this.view = undefined; this.detail = msg('interaction.unknown');
      } else return;
    }
    void this.request({ operation: 'interaction.observe', api_version: 1 });
  }
  respond(observed: InteractionView, action: InteractionAction, value?: string) {
    if (this.closed || this.busy || this.state !== 'ready' || observed !== this.view || observed.state !== 'active'
      || this.retired.has(observed.interaction_id) || !observed.actions.includes(action)) return;
    if (action === 'confirm' || action === 'select') {
      if (!observed.choices.some(c => c.choice_id === value && c.enabled)) return;
    }
    if (action === 'text' && (value === undefined || /[\r\n\0]/.test(value))) return;
    const request: InteractionRequest = { operation: 'interaction.respond', api_version: 1, interaction_id: observed.interaction_id, action };
    if (action === 'text') request.text = value;
    if (action === 'confirm' || action === 'select') request.choice_id = value;
    this.view = undefined;
    void this.request(request);
  }
  canRespond(view: InteractionView) { return !this.closed && this.state === 'ready' && !this.busy
    && view.state === 'active' && !this.retired.has(view.interaction_id); }
  private async request(request: InteractionRequest) {
    const identity = this.identity;
    if (!identity || this.closed || this.pending) return;
    const pending = { request, started: performance.now(), id: undefined as number | undefined };
    this.pending = pending; this.changed();
    try {
      const admission = await this.transport(identity.session, request);
      if (this.closed || this.pending !== pending || this.identity !== identity) return;
      if (admission.state === 'submitted' && admission.generation === identity.generation && Number.isSafeInteger(admission.id)) {
        pending.id = admission.id;
      } else {
        this.pending = undefined; this.view = undefined;
        if (request.operation === 'interaction.respond' && admission.state !== 'not-sent') this.retired.add(request.interaction_id);
        this.detail = admission.state === 'not-sent' ? admission.detail : msg('interaction.unknown');
      }
    } catch (reason) {
      if (this.pending !== pending) return;
      if (request.operation === 'interaction.respond') this.retired.add(request.interaction_id);
      this.pending = undefined; this.view = undefined; this.detail = msg('interaction.unknown');
      if (request.operation === 'interaction.observe') this.detail = errorText(reason);
    }
    this.changed();
  }
  retire() { this.pending = undefined; this.view = undefined; this.identity = undefined; this.retired.clear(); }
  close() { this.closed = true; this.retire(); this.state = 'disconnected'; this.changed(); }
}
