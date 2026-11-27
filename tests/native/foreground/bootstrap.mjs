import { createHash } from 'node:crypto';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function payload() {
  // Same bounded animated payload as webdriver/attachment-preview.mjs, without its driver dependencies.
  const bytes = [...Buffer.from('R0lGODlhAgABAIAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgABAAACAgQKACH5BAAUAAAALAAAAAACAAEAAAICTAoAOw==', 'base64')];
  const fixture = { bytes, image: { imageId: 'a'.repeat(32), sourceSequence: 1, outputIndex: 0,
    source: 'codex.imageGeneration', mimeType: 'image/gif', byteLength: bytes.length,
    sha256: hash(Buffer.from(bytes)), width: 2, height: 1 } };
  if (fixture.bytes.length !== fixture.image.byteLength || hash(Buffer.from(fixture.bytes)) !== fixture.image.sha256)
    throw new Error('Generated fixture integrity mismatch');
  return fixture;
}

// Serialized only into the invocation's packaged assets, before the ordinary entry module.
export function bootstrap({ invocation, fixture, budgetMs }) {
  const original = window.__TAURI_INTERNALS__;
  if (!original?.invoke) throw new Error('Foreground fixture requires the normal Tauri bridge');
  const ready = (async () => {
    if (!fixture) return;
    const { image, bytes } = fixture;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== image.byteLength || digest !== image.sha256 || image.imageId !== 'a'.repeat(32))
      throw new Error('Synthetic image identity/digest mismatch');
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: image.mimeType }));
    try {
      const decoded = new Image(); decoded.src = url; await decoded.decode();
      if (decoded.naturalWidth !== image.width || decoded.naturalHeight !== image.height)
        throw new Error('Synthetic image dimensions mismatch');
    } finally { URL.revokeObjectURL(url); }
  })();
  const response = async (command, args) => {
    await ready;
    if (command === 'runner_images_list') return { images: [fixture.image], incomplete: null };
    if (args?.imageId !== fixture.image.imageId) throw new Error('Synthetic image identity mismatch');
    return { image: fixture.image, bytes: fixture.bytes };
  };
  if (fixture) {
    const target = window.chrome.webview, send = target.postMessage;
    target.postMessage = raw => {
      let message;
      try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch { return send.call(target, raw); }
      if (!['runner_images_list', 'runner_image_read'].includes(message?.cmd)) return send.call(target, raw);
      response(message.cmd, message.payload).then(value => original.runCallback(message.callback, value),
        error => original.runCallback(message.error, String(error.message)));
    };
    const fetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href);
      const command = url.pathname.slice(1);
      if ((url.hostname === 'ipc.localhost' || url.protocol === 'ipc:')
          && ['runner_images_list', 'runner_image_read'].includes(command)) {
        try { return new Response(JSON.stringify(await response(command, JSON.parse(init.body))),
          { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }); }
        catch (error) { return new Response(JSON.stringify(String(error.message)),
          { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } }); }
      }
      return fetch.call(window, input, init);
    };
  }
  const report = async (actual, code) => original.invoke('hub_log', { request: { retentionDays: 1,
    event: { component: 'foreground-fixture', operation: invocation, runner: 'none',
      target: location.origin, expected: fixture ? fixture.image.sha256 : 'plain', actual, code,
      nextAction: 'setup-only-no-input' } } });
  const started = performance.now();
  const inspect = async () => {
    try {
      await ready;
      if (!document.querySelector('#app .installation-setup[open]') && !document.querySelector('#app dialog[open]')) {
        if (performance.now() - started >= budgetMs) throw new Error('Renderer readiness timeout');
        setTimeout(inspect, 200); return;
      }
      if (!location.hostname.endsWith('tauri.localhost')) throw new Error('Packaged asset origin required');
      if (fixture) {
        const list = await original.invoke('runner_images_list', { id: 'fixture-setup-only' });
        const read = await original.invoke('runner_image_read', { id: 'fixture-setup-only', imageId: fixture.image.imageId });
        if (JSON.stringify(list.images) !== JSON.stringify([fixture.image])
            || JSON.stringify(read.image) !== JSON.stringify(fixture.image)
            || JSON.stringify(read.bytes) !== JSON.stringify(fixture.bytes))
          throw new Error('Image list/read bootstrap mismatch');
        let rejected = false;
        try { await original.invoke('runner_image_read', { imageId: 'wrong' }); } catch { rejected = true; }
        if (!rejected) throw new Error('Image mismatch was not rejected');
      }
      await report(fixture ? 'synthetic-ready' : 'plain-ready', 'renderer-and-bridge-ready');
    } catch (error) { await report('setup-failed', String(error.message).replace(/[^a-zA-Z0-9 .:/_-]/g, '').slice(0, 256)); }
  };
  void inspect();
}

export function bootSource(invocation, fixture, budgetMs) {
  return `(${bootstrap.toString()})(${JSON.stringify({ invocation, fixture, budgetMs })});\n`;
}
