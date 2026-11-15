import { invoke } from '@tauri-apps/api/core';
import formats from '../../src-tauri/src/preview_formats.json';

export const previewExtensions = formats;
export const attachmentName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
export function previewKind(path: string): 'image' | 'text' | 'unsupported' {
  const name = attachmentName(path);
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
  if ((previewExtensions.image as readonly string[]).includes(extension)) return 'image';
  if ((previewExtensions.text as readonly string[]).includes(extension)) return 'text';
  return 'unsupported';
}
export type LocalPreview = { kind: 'image'; url: string } | { kind: 'text'; text: string }
  | { kind: 'loading' } | { kind: 'unavailable'; reason: string };
type NativePreview = { path: string } & ({ kind: 'image'; base64: string }
  | { kind: 'text'; text: string } | { kind: 'unavailable'; reason: string });
// One bounded sequential reader per selection avoids competing decoders and large IPC fan-out.
// Preview bytes have no submission semantics; cancellation invalidates the entry before completion.
export class LocalPreviews {
  private entries = new Map<number, { path: string; value: LocalPreview; bytes: number }>();
  private queue = Promise.resolve();
  private disposed = false;
  get(key: number) { return this.entries.get(key)?.value; }
  constructor(private readonly changed: () => void) {}
  load(key: number, path: string) {
    if (this.disposed || this.entries.has(key)) return;
    const entry = { path, value: { kind: 'loading' } as LocalPreview, bytes: 0 };
    this.entries.set(key, entry);
    this.changed();
    this.queue = this.queue.then(async () => {
      if (this.entries.get(key) !== entry) return;
      try {
        const result = await invoke<NativePreview>('local_file_preview', { path });
        if (this.entries.get(key) !== entry || this.disposed) return;
        if (result.path !== path) throw new Error('Preview source identity mismatch');
        if (result.kind === 'image') {
          // Limit retained local image URLs independently of native decoder memory.
          const retained = [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0);
          if (retained + result.base64.length * 3 / 4 > 64 * 1024 * 1024) { entry.value = { kind: 'unavailable', reason: 'capacity' }; }
          else {
            const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
            entry.bytes = bytes.byteLength;
            entry.value = { kind: 'image', url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) };
          }
        } else entry.value = result;
      } catch { if (this.entries.get(key) === entry) entry.value = { kind: 'unavailable', reason: 'unreadable' }; }
      finally { if (!this.disposed && this.entries.get(key) === entry) this.changed(); }
    });
  }
  release(key: number) {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (entry?.value.kind === 'image') URL.revokeObjectURL(entry.value.url);
  }
  dispose() { this.disposed = true; for (const key of this.entries.keys()) this.release(key); }
}
