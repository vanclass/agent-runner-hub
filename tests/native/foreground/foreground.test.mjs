import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { bootSource, payload } from './bootstrap.mjs';
import { foregroundEnvironment } from './fixture.mjs';

function renderer(fixture) {
  const forwarded = [], records = [];
  const originalFetch = async (url, init) => {
    forwarded.push(new URL(url).pathname.slice(1));
    return new Response(JSON.stringify({ ordinary: true }));
  };
  const context = { crypto: webcrypto, Buffer, URL, Blob, Response, Uint8Array, performance, setTimeout,
    Image: class { naturalWidth = 2; naturalHeight = 1; async decode() {} },
    document: { querySelector: () => ({ open: true }) }, location: { origin: 'http://tauri.localhost', hostname: 'tauri.localhost', href: 'http://tauri.localhost/' },
    fetch: originalFetch, chrome: { webview: { postMessage: raw => forwarded.push(raw) } } };
  context.window = context;
  context.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    if (command === 'hub_log') { records.push(args.request.event); return {}; }
    const result = await context.fetch('http://ipc.localhost/' + command, { body: JSON.stringify(args) });
    const body = await result.json();
    if (result.headers.get('Tauri-Response') === 'error') throw new Error(body);
    return body;
  }, runCallback() {} };
  vm.runInNewContext(bootSource('unit-fixture', fixture, 1000), context);
  return { context, forwarded, records };
}

async function completed(records) {
  for (let n = 0; n < 100 && !records.length; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(records.length, 1); return records[0];
}

test('staged synthetic bootstrap validates real bytes, scopes list/read and forwards ordinary commands', async () => {
  const fixture = payload(), { context, forwarded, records } = renderer(fixture);
  assert.equal((await completed(records)).actual, 'synthetic-ready');
  for (const command of ['runner_observe', 'runner_command', 'runner_resolve'])
    assert.deepEqual(await context.__TAURI_INTERNALS__.invoke(command, {}), { ordinary: true });
  assert.deepEqual(forwarded, ['runner_observe', 'runner_command', 'runner_resolve']);
  assert.equal(records[0].expected, fixture.image.sha256);
});

test('corrupted fixture produces scoped setup failure rather than readiness or behavior success', async () => {
  const fixture = payload(); fixture.bytes[0] ^= 1;
  const { records } = renderer(fixture);
  const result = await completed(records);
  assert.equal(result.actual, 'setup-failed');
  assert.match(result.code, /identity\/digest mismatch/);
});

test('plain bootstrap leaves image/authentication transport untouched', async () => {
  const { context, forwarded, records } = renderer(null);
  assert.equal((await completed(records)).actual, 'plain-ready');
  await context.__TAURI_INTERNALS__.invoke('runner_images_list', {});
  assert.deepEqual(forwarded, ['runner_images_list']);
});

test('foreground environment has isolated directories without debug port or inherited credentials', { skip: process.platform !== 'win32' }, () => {
  const folder = 'C:\\owned-fixture';
  const env = foregroundEnvironment(folder);
  for (const name of ['TAURI_WEBDRIVER_PORT', 'RUNNER_AUTH_TOKEN', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']) assert.equal(env[name], undefined);
  for (const name of ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'WEBVIEW2_USER_DATA_FOLDER']) assert.ok(env[name].startsWith(folder));
});
