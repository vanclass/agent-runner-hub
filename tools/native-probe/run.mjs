import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { remote } from 'webdriverio';
import { buildProbe } from './build.mjs';
import { startOwner, isolatedEnvironment } from './owner.mjs';
import { observeHub } from '../../tests/native/webdriver/probe.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
// 초기 준비 제한 시간이다. 늘리면 느린 호스트를 더 기다리고, 줄이면 실패를 빨리 알린다.
const startupMs = 60_000;
// 명령과 종료 제한 시간이다. 늘리면 지연을 허용하고, 줄이면 정지를 빨리 감지한다.
const commandMs = 10_000;
const controller = new AbortController();
const cancel = () => controller.abort(new Error('Native probe cancelled'));
const signals = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  return port;
}
async function until(work, signal) {
  const deadline = Date.now() + startupMs;
  do {
    signal.throwIfAborted();
    const value = await work();
    if (value) return value;
    await delay(200, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error('Native readiness timeout');
}
function noActivation(state) { assert.equal(state.activationObserved, false, 'Test Hub acquired foreground activation'); }

async function run() {
  if (process.argv.includes('--help')) {
    console.log('npm run test:native:probe [-- --target-dir <absolute Cargo cache>]\nWindows actual-renderer probe. Builds a dedicated debug executable and uses isolated data; never attaches to a running Hub.\nmacOS configuration is reviewed only; this native owner requires Windows.');
    return;
  }
  if (process.platform !== 'win32') throw new Error('Windows process owner required; macOS native acceptance is unverified');
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--target-dir' && path.isAbsolute(args[1]))) throw new Error('Use --help');
  const target = args.length ? path.resolve(args[1]) : path.join(root, 'local/native-probe/target');
  const evidenceDir = path.join(root, 'temp/native-probe', randomUUID());
  await fs.mkdir(evidenceDir, { recursive: true });
  const attempt = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-wg1-'));
  const evidence = { schemaVersion: 1, platform: process.platform, startedAt: new Date().toISOString(),
    macOS: 'configuration reviewed; execution unverified', focusRequired: 'unverified; excluded from this probe', stages: {} };
  let owner, browser, failure;
  for (const signal of signals) process.on(signal, cancel);
  try {
    await fs.mkdir(target, { recursive: true });
    evidence.build = await buildProbe(root, attempt, target, controller.signal);
    const port = await freePort();
    for (const name of ['user', 'user/roaming', 'user/local', 'tmp', 'app-data', 'webview2']) await fs.mkdir(path.join(attempt, name), { recursive: true });
    evidence.environmentKeys = Object.keys(isolatedEnvironment(attempt, port));
    owner = await startOwner(root, evidence.build.executable, attempt, port, commandMs);
    evidence.pid = owner.pid;
    evidence.stages.hidden = await until(async () => {
      const snapshot = await owner.request('snapshot');
      return snapshot.hwnd ? snapshot : null;
    }, controller.signal);
    assert.equal(evidence.stages.hidden.visible, false);
    noActivation(evidence.stages.hidden);
    // Bind ownership before any HTTP request; a status response alone is not identity.
    evidence.listener = await until(async () => {
      const state = await owner.request('listener');
      return state.listeners.length ? state : null;
    }, controller.signal);
    browser = await remote({ hostname: '127.0.0.1', port, path: '/', logLevel: 'silent',
      connectionRetryCount: 0, connectionRetryTimeout: commandMs, waitforTimeout: commandMs,
      capabilities: { browserName: 'tauri' } });
    evidence.stages.connected = await owner.request('snapshot');
    noActivation(evidence.stages.connected);
    controller.signal.throwIfAborted();
    evidence.renderer = await observeHub(browser);
    evidence.stages.hiddenInteraction = await owner.request('snapshot');
    noActivation(evidence.stages.hiddenInteraction);
    controller.signal.throwIfAborted();
    evidence.stages.placed = await owner.request('show');
    assert.equal(evidence.stages.placed.hwnd, evidence.stages.hidden.hwnd, 'Owned main HWND changed');
    assert.equal(evidence.stages.placed.visible, true);
    assert.equal(evidence.stages.placed.foregroundAbove, true, 'Foreground window must be above the test window');
    noActivation(evidence.stages.placed);
    await browser.saveScreenshot(path.join(evidenceDir, 'renderer.png'));
    evidence.visibleDOM = await browser.execute(() => ({ visibility: document.visibilityState,
      setupOpen: !!document.querySelector('.app-settings[open]'), theme: document.querySelector('.hub')?.getAttribute('data-theme') }));
    assert.equal(evidence.visibleDOM.setupOpen, true);
    evidence.stages.observed = await owner.request('snapshot');
    noActivation(evidence.stages.observed);
  } catch (error) { failure = error; evidence.failure = error.message; }
  finally {
    if (browser) {
      try { await browser.deleteSession(); } catch (error) { failure ||= error; evidence.sessionCleanupFailure = error.message; }
    }
    if (owner) {
      try {
        evidence.teardown = await owner.stop();
        noActivation(evidence.teardown);
        assert.equal(evidence.teardown.forced, false);
        assert.equal(evidence.teardown.exitCode, 0);
        assert.equal(evidence.teardown.listenerReleased, true);
      }
      catch (error) { failure ||= error; evidence.teardownFailure = error.message; }
    }
    try {
      // Remove only the exact invocation directory after owned process settlement.
      assert.ok(!owner || evidence.teardown?.stopped, 'Owned Hub settlement is required before removing its files');
      assert.equal(path.dirname(attempt), os.tmpdir());
      await fs.rm(attempt, { recursive: true, maxRetries: 10, retryDelay: 200 });
      evidence.resourcesReleased = true;
    } catch (error) { failure ||= error; evidence.resourceFailure = error.message; }
    for (const signal of signals) process.removeListener(signal, cancel);
    evidence.outcome = failure ? 'failed' : 'passed';
    await fs.writeFile(path.join(evidenceDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    console.log(`Native probe ${evidence.outcome}: ${evidenceDir}`);
  }
  if (failure) throw failure;
}
await run().catch(error => { console.error(error.message); process.exitCode = 1; });
