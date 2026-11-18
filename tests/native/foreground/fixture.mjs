import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildForeground } from './build.mjs';
import { isolatedEnvironment } from '../../../tools/native-probe/platforms/windows.mjs';
import { startProtocol } from '../../../tools/native-probe/protocol.mjs';
import { startupMs, commandMs, pollMs } from '../../../tools/native-probe/limits.mjs';

export async function waitFor(probe, budget = startupMs) {
  const deadline = Date.now() + budget;
  do {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  } while (Date.now() < deadline);
  throw new Error('Foreground setup readiness timeout');
}

export function foregroundEnvironment(attempt) {
  const env = isolatedEnvironment(attempt, 0);
  delete env.TAURI_WEBDRIVER_PORT;
  return env;
}

// The returned process belongs only to this fixture. Consumers must settle it before cleanup.
export async function removeForegroundAttempt(attempt, settled) {
  assert.ok(settled, 'Preserve profile for unsettled owner');
  assert.equal(path.dirname(attempt), os.tmpdir());
  await fs.rm(attempt, { recursive: true, maxRetries: 10, retryDelay: pollMs });
}

export async function createForeground(root, { synthetic = false, signal, target = path.join(root, 'local/native-foreground/target') } = {}) {
  assert.equal(process.platform, 'win32', 'Foreground fixture is Windows-only');
  const invocation = randomUUID(), attempt = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-fg-'));
  let owner, settled = true;
  const evidence = { invocation, mode: synthetic ? 'synthetic' : 'plain', stage: 'build', attempt,
    input: 'none', productAcceptance: 'unverified' };
  async function close() {
    if (owner) {
      evidence.settlement = await owner.stop();
      settled = evidence.settlement.stopped && evidence.settlement.childrenSettled
        && !evidence.settlement.forced && evidence.settlement.exitCode === 0;
      owner = null;
      assert.ok(settled, 'Owned clean settlement required');
    }
    await removeForegroundAttempt(attempt, settled);
    evidence.profileRemoved = !(await fs.stat(attempt).catch(() => null));
  }
  try {
    evidence.build = await buildForeground(root, attempt, target, invocation, synthetic, signal ?? new AbortController().signal);
    evidence.stage = 'process';
    for (const name of ['user/roaming', 'user/local', 'tmp', 'app-data', 'webview2'])
      await fs.mkdir(path.join(attempt, name), { recursive: true });
    settled = false;
    owner = await startProtocol(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/native/foreground/windows-owner.ps1'),
        '-Executable', evidence.build.executable, '-ExpectedSha256', evidence.build.executableSha256, '-BudgetMs', String(commandMs)],
      { cwd: attempt, windowsHide: true, shell: false, env: foregroundEnvironment(attempt), stdio: ['pipe', 'pipe', 'pipe'] }, startupMs);
    evidence.pid = owner.pid;
    evidence.window = await waitFor(async () => {
      const state = await owner.request('snapshot'); return state.hwnd ? state : null;
    });
    evidence.stage = 'renderer';
    assert.equal(path.resolve(evidence.window.executable), path.resolve(evidence.build.executable));
    assert.equal(evidence.window.executableSha256, evidence.build.executableSha256);
    assert.equal(evidence.window.ownership, 'job-before-resume');
    const log = path.join(attempt, 'app-data/hub-logs/events.jsonl');
    evidence.readiness = await waitFor(async () => {
      const bytes = await fs.readFile(log, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
      const records = bytes.split('\n').filter(Boolean).map(line => JSON.parse(line));
      return records.find(record => record.component === 'foreground-fixture' && record.operation === invocation);
    });
    assert.equal(evidence.readiness.actual, synthetic ? 'synthetic-ready' : 'plain-ready', evidence.readiness.code);
    assert.equal(evidence.readiness.expected, synthetic ? evidence.build.fixture.sha256 : 'plain');
    evidence.stage = 'presentation';
    evidence.displayed = await owner.request('show');
    assert.ok(evidence.displayed.visible && evidence.displayed.enabled && !evidence.displayed.noActivateStyle
      && evidence.displayed.hwnd === evidence.window.hwnd);
    evidence.inspection = await owner.request('inspect');
    assert.equal(evidence.inspection.profileCorrelated, true, 'Owned WebView process must use this exact profile');
    assert.deepEqual(evidence.inspection.listeners, [], 'Ordinary fixture must expose no listener');
    evidence.stage = 'ready';
    return { evidence, attempt, pid: owner.pid, request: action => owner.request(action), close };
  } catch (error) {
    evidence.failure = { stage: evidence.stage, reason: error.message };
    try { await close(); } catch (cleanup) { evidence.cleanupFailure = cleanup.message; }
    error.evidence = evidence; throw error;
  }
}
