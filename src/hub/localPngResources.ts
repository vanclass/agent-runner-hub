const MAX_RETAINED_BYTES = 64 * 1024 * 1024;

// Each local selection has its own image budget and URLs.
export class LocalPngResources {
  private retained = 0;

  acquire(base64: string) {
    if (this.retained + base64.length * 3 / 4 > MAX_RETAINED_BYTES)
      return { value: { kind: 'unavailable' as const, reason: 'capacity' } };

    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const size = bytes.byteLength;
    this.retained += size;
    return {
      value: { kind: 'image' as const, url },
      release: () => {
        URL.revokeObjectURL(url);
        this.retained -= size;
      },
    };
  }
}
