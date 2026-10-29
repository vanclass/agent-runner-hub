import { msg, errorText, type HubText } from './i18n';
import { invoke } from '@tauri-apps/api/core';

export type GeneratedImage = { imageId: string; sourceSequence: number; outputIndex: number;
  source: string; mimeType: string; byteLength: number; sha256: string; width: number; height: number };
type Verified = { image: GeneratedImage; png: number[] };
type Preview = { url: string; bytes: number; image: GeneratedImage; changed: () => void };
type State = 'loading' | 'available' | 'empty' | 'unsupported' | 'unavailable' | 'failed';
const previews = new Map<symbol, Preview>();
let reads = 0;
// Process-local budgets bound retained Blob resources across all Runner tabs.
const cacheBytes = 64 * 1024 * 1024;
const cacheEntries = 8;
const same = (a: GeneratedImage, b: GeneratedImage) => a.imageId === b.imageId && a.sha256 === b.sha256
  && a.byteLength === b.byteLength && a.width === b.width && a.height === b.height
  && a.sourceSequence === b.sourceSequence && a.outputIndex === b.outputIndex && a.source === b.source && a.mimeType === b.mimeType;
function release(owner: symbol) {
  const previous = previews.get(owner);
  if (!previous) return;
  URL.revokeObjectURL(previous.url);
  previews.delete(owner);
  previous.changed();
}
function retain(owner: symbol, item: Preview) {
  release(owner);
  while (previews.size >= cacheEntries || [...previews.values()].reduce((sum, value) => sum + value.bytes, 0) + item.bytes > cacheBytes)
    release(previews.keys().next().value!);
  previews.set(owner, item);
}

export class RunnerImages {
  state: State = 'loading';
  detail: HubText = msg('runtime.images.waiting');
  items: GeneratedImage[] = [];
  selectedId?: string;
  private readonly owner = Symbol('Runner images');
  private id?: string;
  private stopped = false;
  private active = false;
  private supported = false;
  private ready = false;
  private blocked = false;
  private working = false;
  private discoveredAt = -Infinity;
  private scope = 0;
  private attributionUnavailable = false;
  get attributionAvailable() { return !this.attributionUnavailable; }
  beginPresentation() {
    this.scope++;
    // The connection-owned image protocol has no tab/work identity or promotion watermark.
    this.attributionUnavailable = true;
    this.items = []; this.selectedId = undefined; release(this.owner);
    this.discoveredAt = -Infinity;
    this.state = 'unavailable'; this.detail = msg('runtime.images.scopeUnavailable');
  }
  constructor(private readonly changed: () => void) {}
  start(id: string) { this.id = id; }
  get busy() { return this.working; }
  get preview() { return previews.get(this.owner); }
  get selected() { return this.items.find(image => image.imageId === this.selectedId); }
  mount() { this.active = true; this.tick(); return () => { this.active = false; }; }
  observe(supported: boolean, ready: boolean, blocked: boolean) {
    this.supported = supported; this.ready = ready; this.blocked = blocked;
    if (!ready || !supported) {
      release(this.owner); this.items = [];
      this.state = !ready ? 'unavailable' : 'unsupported';
      this.detail = !ready ? msg('runtime.images.connectionUnavailable') : msg('runtime.images.unsupported');
      return;
    }
    if (this.attributionUnavailable) {
      this.state = 'unavailable'; this.detail = msg('runtime.images.scopeUnavailable'); return;
    }
    this.tick();
  }
  private tick() {
    if (this.stopped || this.attributionUnavailable || !this.active || !this.id || !this.ready || !this.supported || this.blocked || this.working) return;
    // Discovery shares the existing observation cadence; inactive tabs issue no image polling.
    if (performance.now() - this.discoveredAt >= 15000) void this.refresh();
    else if (this.selected && !this.preview && this.state !== 'failed' && this.state !== 'unavailable') void this.load();
  }
  select(id: string) {
    if (!this.items.some(image => image.imageId === id)) return;
    this.selectedId = id; release(this.owner);
    this.state = 'loading'; this.detail = msg('runtime.images.verifying'); this.changed();
    if (!this.working) void this.load();
  }
  async refresh(manual = false) {
    const id = this.id;
    const scope = this.scope;
    if (this.attributionUnavailable) {
      this.state = 'unavailable'; this.detail = msg('runtime.images.scopeUnavailable'); this.changed(); return;
    }
    if (this.stopped || !id || !this.ready || !this.supported || this.working) return;
    this.working = true; this.state = 'loading'; this.detail = msg('runtime.images.discovering');
    if (manual) release(this.owner);
    this.changed();
    try {
      const items = await invoke<GeneratedImage[]>('runner_images_list', { id });
      if (this.stopped || this.id !== id || scope !== this.scope || !this.ready || !this.supported) return;
      const previous = this.selected;
      this.items = items;
      if (!this.selected) this.selectedId = items[0]?.imageId;
      if (!previous || !this.selected || !same(previous, this.selected)) release(this.owner);
      this.discoveredAt = performance.now();
      this.state = items.length ? 'available' : 'empty';
      this.detail = items.length ? msg('runtime.images.previews') : msg('runtime.images.empty');
    } catch (reason) { if (scope === this.scope) this.failure(reason); }
    finally { this.working = false; this.changed(); if (scope !== this.scope) this.tick(); }
    if (!this.stopped && this.active && this.selected && !this.preview && this.state === 'available') void this.load();
  }
  private async load() {
    const id = this.id, selected = this.selected;
    const scope = this.scope;
    if (this.stopped || !id || !selected || !this.ready || !this.supported || this.working || reads >= 2) return;
    this.working = true; reads++;
    this.state = 'loading'; this.detail = msg('runtime.images.retrieving'); this.changed();
    try {
      const verified = await invoke<Verified>('runner_image_read', { id, imageId: selected.imageId });
      if (this.stopped || this.id !== id || scope !== this.scope || !this.ready || !this.supported || !this.selected || !same(selected, this.selected)) return;
      if (!same(verified.image, selected) || verified.png.length !== selected.byteLength)
        throw { state: 'failed', detail: msg('runtime.images.mismatch') };
      const url = URL.createObjectURL(new Blob([new Uint8Array(verified.png)], { type: 'image/png' }));
      retain(this.owner, { url, bytes: selected.byteLength, image: selected, changed: this.changed });
      this.state = 'available'; this.detail = msg('runtime.images.verified');
    } catch (reason) {
      if (scope === this.scope && this.selectedId === selected.imageId) this.failure(reason);
    } finally {
      this.working = false; reads--; this.changed();
      if (scope !== this.scope) this.tick();
      if (!this.stopped && this.active && this.selectedId !== selected.imageId) void this.load();
    }
  }
  private failure(reason: unknown) {
    if (this.stopped) return;
    release(this.owner);
    const failure = reason as { state?: string; detail?: HubText } | null;
    this.state = failure?.state === 'unavailable' ? 'unavailable' : 'failed';
    this.detail = failure?.detail ?? msg('runtime.images.failedWithDiagnostic', { diagnostic: errorText(reason) });
    this.discoveredAt = performance.now();
  }
  rejectRendering() { this.failure({ state: 'failed', detail: msg('runtime.images.renderFailed') }); this.changed(); }
  stop() {
    this.stopped = true; this.ready = false; this.active = false;
    this.items = []; this.selectedId = undefined; release(this.owner);
    this.state = 'unavailable'; this.detail = msg('runtime.images.ownerEnded');
  }
}
