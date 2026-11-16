import { invoke } from '@tauri-apps/api/core';

export type PresentationSpan = { text: string; style: string };
type Activity = { activity_id: string; action: 'replace' | 'retire'; text?: string; spans?: PresentationSpan[] };
type LogEvent = { sequence: number; type: 'log'; record_id: number; text: string;
  start_offset: number; end_offset: number; final_fragment: boolean; terminate_line: boolean;
  line_ending: 'ensure' | 'append'; spans: PresentationSpan[] };
type Event = LogEvent | (Activity & { sequence: number; type: 'activity' })
  | { sequence: number; type: 'gap'; reason: string; record_id?: number };
export type PresentationRecord = { id: number; spans: PresentationSpan[]; text: string };
type Subscription = { stream_id: string; subscription_id: string; snapshot_sequence: number;
  first_sequence: number; activities: Activity[]; closed: boolean };
type Page = { stream_id: string; subscription_id: string; events: Event[]; next_sequence: number;
  through_sequence: number; caught_up: boolean; coverage: string; missing_range: number[] | null; closed: boolean };
export type PresentationRequest = { operation: string; api_version: number; types?: string[];
  subscription_id?: string; after_sequence?: number };
const sequence = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function spans(text: unknown, value: unknown): asserts value is PresentationSpan[] {
  if (typeof text !== 'string' || text.includes('\x1b') || !Array.isArray(value)
    || value.some(s => typeof s?.text !== 'string' || typeof s?.style !== 'string' || s.style.includes('\x1b'))
    || value.map(s => s.text).join('') !== text) throw new Error('Invalid semantic spans');
}

// One process/session stream, independent of mounted tabs and durable Hub event history.
export class PresentationState {
  mode: 'connecting' | 'unsupported' | 'streaming' | 'closed' | 'failed' = 'connecting';
  records: PresentationRecord[] = [];
  activities = new Map<string, Activity>();
  issues = new Set<string>();
  cursor = 0;
  caughtUp = false;
  scrollTop = 0;
  follow = true;
  subscription?: Subscription;
  private snapshotApplied = false;
  private lastRecord = 0;
  private throughSequence = 0;
  private fragment?: { id: number; offset: number; text: string; spans: PresentationSpan[] };
  get incomplete() { return this.issues.size > 0; }
  subscribe(input: unknown) {
    const value = input as Subscription;
    if (!value || typeof value.stream_id !== 'string' || typeof value.subscription_id !== 'string'
      || !sequence(value.snapshot_sequence) || !sequence(value.first_sequence) || value.first_sequence < 1
      || !Array.isArray(value.activities) || typeof value.closed !== 'boolean') throw new Error('Invalid presentation snapshot');
    if (this.subscription) throw new Error('Presentation stream replacement requires a verified session replacement');
    const identities = new Set<string>();
    for (const activity of value.activities) {
      this.validateActivity(activity);
      if (activity.action !== 'replace' || identities.has(activity.activity_id)) throw new Error('Invalid Activity snapshot');
      identities.add(activity.activity_id);
    }
    this.subscription = value;
    this.mode = 'streaming';
    if (value.first_sequence > 1) this.gap(`Missing startup output: sequences 1–${value.first_sequence - 1}`);
    this.applySnapshot(0);
  }
  gap(reason: string) { this.issues.add(reason); this.fragment = undefined; }
  private validateActivity(event: Activity) {
    if (typeof event.activity_id !== 'string' || !event.activity_id || !['replace', 'retire'].includes(event.action))
      throw new Error('Invalid Activity identity or action');
    if (event.action === 'replace') spans(event.text, event.spans);
  }
  private activity(event: Activity) {
    this.validateActivity(event);
    if (event.action === 'retire') this.activities.delete(event.activity_id);
    else this.activities.set(event.activity_id, event);
  }
  private applySnapshot(through: number) {
    if (this.snapshotApplied || !this.subscription || through < this.subscription.snapshot_sequence) return;
    this.activities.clear();
    for (const activity of this.subscription.activities) this.activity(activity);
    this.snapshotApplied = true;
  }
  page(input: unknown) {
    const value = input as Page;
    const sub = this.subscription;
    if (!sub || value?.stream_id !== sub.stream_id || value.subscription_id !== sub.subscription_id)
      throw new Error('Presentation stream identity changed; cursor was not reused');
    if (!sequence(value.next_sequence) || value.next_sequence < this.cursor || !sequence(value.through_sequence)
      || value.through_sequence < Math.max(sub.snapshot_sequence, this.throughSequence)
      || value.next_sequence > value.through_sequence || !Array.isArray(value.events)
      || typeof value.caught_up !== 'boolean' || value.caught_up !== (value.next_sequence === value.through_sequence)
      || typeof value.closed !== 'boolean' || !['complete', 'incomplete'].includes(value.coverage))
      throw new Error('Invalid presentation page boundary');
    let previous = this.cursor;
    if (value.missing_range !== null) {
      const range = value.missing_range;
      if (!Array.isArray(range) || range.length !== 2 || !range.every(sequence)
        || range[0] !== this.cursor + 1 || range[1] < range[0] || range[1] > value.next_sequence)
        throw new Error('Invalid missing presentation range');
      this.gap(`Missing output: sequences ${range[0]}–${range[1]}`);
      this.activities.clear();
      previous = range[1];
    }
    if (value.coverage === 'incomplete') this.issues.add('Runner reports incomplete presentation coverage');
    for (const event of value.events) {
      if (!sequence(event.sequence) || event.sequence <= previous || event.sequence > value.next_sequence)
        throw new Error('Invalid presentation event order');
      if (event.sequence !== previous + 1) this.gap('Missing presentation events');
      this.applySnapshot(event.sequence - 1);
      if (event.type === 'gap') this.gap(`Runner omitted output: ${event.reason || 'gap'}`);
      else if (event.type === 'log') this.log(event);
      else if (event.type === 'activity') {
        if (event.sequence > sub.snapshot_sequence) this.activity(event);
      } else throw new Error('Unsupported presentation event type');
      previous = event.sequence;
    }
    if (previous !== value.next_sequence) this.gap('Missing presentation events at page boundary');
    if (!value.caught_up && value.next_sequence === this.cursor) throw new Error('Presentation pagination did not advance');
    this.cursor = value.next_sequence;
    this.throughSequence = value.through_sequence;
    this.caughtUp = value.caught_up;
    this.applySnapshot(this.cursor);
    if (value.closed && value.caught_up) {
      this.mode = 'closed';
      this.activities.clear();
      if (!value.caught_up || this.fragment) this.gap('Stream closed before all output was delivered');
    }
  }
  private log(event: LogEvent) {
    spans(event.text, event.spans);
    if (!sequence(event.record_id) || !sequence(event.start_offset) || !sequence(event.end_offset)
      || event.end_offset - event.start_offset !== Array.from(event.text).length
      || typeof event.final_fragment !== 'boolean' || typeof event.terminate_line !== 'boolean'
      || !['ensure', 'append'].includes(event.line_ending)) throw new Error('Invalid log fragment');
    if (this.fragment && this.fragment.id !== event.record_id) this.gap('Log record ended before its final fragment');
    if (!this.fragment) {
      if (event.start_offset !== 0) { this.gap('Log record begins with a missing fragment'); return; }
      if (event.record_id <= this.lastRecord) throw new Error('Log record identity was reused or reordered');
      this.lastRecord = event.record_id;
      this.fragment = { id: event.record_id, offset: 0, text: '', spans: [] };
    }
    const fragment = this.fragment;
    if (fragment.offset !== event.start_offset) { this.gap('Log fragment offsets are discontinuous'); return; }
    fragment.text += event.text;
    fragment.spans.push(...event.spans);
    fragment.offset = event.end_offset;
    if (!event.final_fragment) return;
    if (event.terminate_line && (event.line_ending === 'append' || !fragment.text.endsWith('\n'))) {
      fragment.text += '\n'; fragment.spans.push({ text: '\n', style: '' });
    }
    this.records.push({ id: fragment.id, text: fragment.text, spans: fragment.spans });
    this.fragment = undefined;
  }
  fail(reason: string) { this.mode = 'failed'; this.gap(reason); this.activities.clear(); }
  ended() {
    if (this.mode === 'unsupported') return;
    if (this.mode !== 'closed' || this.fragment) this.gap('Process exited before final presentation delivery was verified');
    this.mode = 'closed'; this.activities.clear();
  }
}

export class RunnerPresentation {
  state = new PresentationState();
  private binding?: { id: string; generation: number };
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private paused = false;
  private stopping?: Promise<void>;
  constructor(private changed: () => void,
    private request = (id: string, generation: number, request: PresentationRequest) =>
      invoke<unknown>('runner_presentation', { id, generation, request }), private pollMs = 500) {}
  observe(id: string, ready: boolean, supported: boolean, generation: number, paused: boolean) {
    if (this.stopped || !ready) return;
    if (this.binding && (id !== this.binding.id || generation !== this.binding.generation)) {
      // Only canonical native session generation changes may introduce a new stream.
      const previous = this.state;
      previous.ended();
      this.state = new PresentationState();
      this.state.records = [...previous.records];
      this.state.issues = new Set(previous.issues);
      this.state.scrollTop = previous.scrollTop;
      this.state.follow = previous.follow;
      this.binding = undefined;
    }
    this.binding ??= { id, generation };
    this.paused = paused;
    if (!supported) {
      clearTimeout(this.timer); this.timer = undefined;
      if (this.state.subscription) this.state.fail('Runner presentation capability became unavailable');
      else this.state.mode = 'unsupported';
      return;
    }
    if (this.state.mode === 'unsupported') this.state.mode = 'connecting';
    if (!this.running && !this.timer && !paused && !['closed', 'failed'].includes(this.state.mode)) this.pump();
  }
  private pump() {
    this.running = this.pull().finally(() => {
      this.running = undefined;
      if (!this.stopped && !['closed', 'failed', 'unsupported'].includes(this.state.mode))
        this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, this.state.caughtUp ? this.pollMs : 0);
    });
  }
  private async pull() {
    const binding = this.binding, state = this.state;
    if (!binding || this.paused || this.stopped) return;
    const request = (body: PresentationRequest) => this.request(binding.id, binding.generation, body);
    try {
      if (!state.subscription) {
        const sub = await request({ operation: 'presentation.subscribe', api_version: 1, types: ['log', 'activity'] });
        if (state !== this.state) return;
        state.subscribe(sub);
      }
      if (this.stopped) return;
      const page = await request({ operation: 'presentation.read', api_version: 1,
        subscription_id: state.subscription!.subscription_id, after_sequence: state.cursor });
      if (this.stopped || state !== this.state) return;
      state.page(page);
    } catch (error) { if (!this.stopped && state === this.state) state.fail(String(error)); }
    finally { this.changed(); }
  }
  stop() { return this.stopping ??= this.release(); }
  private async release() {
    this.stopped = true;
    clearTimeout(this.timer); this.timer = undefined;
    await this.running;
    if (!this.state.subscription && this.state.mode === 'connecting') this.state.mode = 'unsupported';
    const binding = this.binding, sub = this.state.subscription;
    if (binding && sub) {
      try { await this.request(binding.id, binding.generation, { operation: 'presentation.unsubscribe', api_version: 1,
        subscription_id: sub.subscription_id }); }
      catch { /* Process shutdown may already have retired the private stream. */ }
    }
    this.state.ended(); this.changed();
  }
}
