const MAX_RETAINED_BYTES = 64 * 1024 * 1024;

// Each local selection has its own image budget and URLs.
export class LocalImageResources {
  private retained = 0;

  acquire(base64: string, mime: string) {
    if (this.retained + base64.length * 3 / 4 > MAX_RETAINED_BYTES)
      return { value: { kind: 'unavailable' as const, reason: 'capacity' } };

    const decoded = atob(base64);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < bytes.length; index++) bytes[index] = decoded.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
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
