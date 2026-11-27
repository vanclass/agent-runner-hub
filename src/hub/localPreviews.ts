import { invoke } from '@tauri-apps/api/core';
import { LocalImageResources } from './localImageResources';
import { previewFormat } from './previewCatalog';
export type LocalPreview = { kind: 'image'; url: string } | { kind: 'text'; text: string }
  | { kind: 'loading' } | { kind: 'unavailable'; reason: string };
type NativePreview = { path: string } & ({ kind: 'image'; base64: string; mime: string }
  | { kind: 'text'; text: string } | { kind: 'unavailable'; reason: string });
// One bounded sequential reader per selection avoids competing decoders and large IPC fan-out.
// Preview bytes have no submission semantics; cancellation invalidates the entry before completion.
export class LocalPreviews {
  private entries = new Map<number, { value: LocalPreview; release?: () => void }>();
  private images = new LocalImageResources();
  private queue = Promise.resolve();
  private disposed = false;
  get(key: number) { return this.entries.get(key)?.value; }
  constructor(private readonly changed: () => void) {}
  load(key: number, path: string) {
    if (this.disposed || this.entries.has(key)) return;
    const entry: { value: LocalPreview; release?: () => void } = { value: { kind: 'loading' } };
    this.entries.set(key, entry);
    this.changed();
    this.queue = this.queue.then(async () => {
      if (this.entries.get(key) !== entry) return;
      try {
        const result = await invoke<NativePreview>('local_file_preview', { path });
        if (this.entries.get(key) !== entry || this.disposed) return;
        if (result.path !== path) throw new Error('Preview source identity mismatch');
        if (result.kind === 'image') {
          const format = previewFormat(path);
          if (format?.category !== 'image' || result.mime !== (format.previewMime ?? format.mime))
            throw new Error('Preview MIME mismatch');
          Object.assign(entry, this.images.acquire(result.base64, result.mime));
        } else entry.value = result;
      } catch { if (this.entries.get(key) === entry) entry.value = { kind: 'unavailable', reason: 'unreadable' }; }
      finally { if (!this.disposed && this.entries.get(key) === entry) this.changed(); }
    });
  }
  release(key: number) {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    entry?.release?.();
  }
  dispose() { this.disposed = true; for (const key of this.entries.keys()) this.release(key); }
}
