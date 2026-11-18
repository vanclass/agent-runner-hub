import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageLaunchImage } from './build.mjs';
import { hash } from './bootstrap.mjs';
import { foregroundEnvironment, removeForegroundAttempt, waitFor } from './fixture.mjs';
import { startProtocol } from '../../../tools/native-probe/protocol.mjs';
import { commandMs, pollMs, startupMs } from '../../../tools/native-probe/limits.mjs';

const powershell = path.join(process.env.SystemRoot ?? '', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const ownerPath = fileURLToPath(new URL('./windows-owner.ps1', import.meta.url));
const probeSource = fileURLToPath(new URL('./lifecycle-probe.cs', import.meta.url));
function ps(script, env = process.env) {
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script],
    { env, windowsHide: true, encoding: 'utf8', timeout: startupMs });
}
async function compile(folder, version) {
  const executable = path.join(folder, 'probe.exe');
  ps('$source=[IO.File]::ReadAllText($env:PROBE_SOURCE).Replace("VERSION", $env:PROBE_VERSION); ' +
    'Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing ' +
    '-OutputAssembly $env:PROBE_EXECUTABLE -OutputType WindowsApplication',
  { ...process.env, PROBE_SOURCE: probeSource, PROBE_VERSION: version, PROBE_EXECUTABLE: executable });
  return executable;
}
async function launch(build, attempt, tree = false, expected = build.executableSha256) {
  const owner = await startProtocol(powershell, ['-NoProfile', '-NonInteractive', '-File', ownerPath,
    '-Executable', build.executable, '-ExpectedSha256', expected, '-BudgetMs', String(pollMs)],
  { cwd: attempt, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...foregroundEnvironment(attempt), FOREGROUND_PROBE_FOLDER: attempt,
      FOREGROUND_PROBE_BUDGET: String(startupMs), FOREGROUND_PROBE_TREE: tree ? '1' : '0' } }, startupMs);
  await waitFor(async () => (await owner.request('snapshot')).hwnd);
  return owner;
}
async function present(file) { return fs.stat(file).then(() => true, () => false); }

// This launches the actual Windows owner against a tiny fixture-owned WinForms image.
test('launch handoff retains distinct images after shared-cache replacement and overlapping lifetimes',
  { skip: process.platform !== 'win32' }, async () => {
    const first = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-fg-test-'));
    const second = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-fg-test-'));
    const cache = path.join(first, 'cache'); await fs.mkdir(cache);
    let ownerA, ownerB, cleanA = true, cleanB = true;
    try {
      const cached = await compile(cache, 'A');
      const imageA = await stageLaunchImage(cached, first);
      await fs.unlink(cached); await compile(cache, 'B');
      const imageB = await stageLaunchImage(cached, second);
      assert.notEqual(imageA.executableSha256, imageB.executableSha256);
      assert.equal(hash(await fs.readFile(imageA.executable)), imageA.executableSha256);
      cleanA = false; ownerA = await launch(imageA, first);
      cleanB = false; ownerB = await launch(imageB, second);
      assert.equal(await fs.readFile(path.join(first, 'image-version'), 'utf8'), 'A');
      assert.equal(await fs.readFile(path.join(second, 'image-version'), 'utf8'), 'B');
      for (const [owner, image] of [[ownerA, imageA], [ownerB, imageB]]) {
        const state = await owner.request('snapshot');
        assert.equal(path.resolve(state.executable), path.resolve(image.executable));
        assert.equal(state.executableSha256, image.executableSha256);
        assert.equal(state.ownership, 'job-before-resume');
      }
      await assert.rejects(launch(imageB, second, false, '0'.repeat(64)), /Launch image digest mismatch/);
    } finally {
      if (ownerB) { const result = await ownerB.stop(); cleanB = result.stopped && result.childrenSettled && !result.forced; }
      if (ownerA) { const result = await ownerA.stop(); cleanA = result.stopped && result.childrenSettled && !result.forced; }
      await removeForegroundAttempt(second, cleanB); await removeForegroundAttempt(first, cleanA);
    }
  });

test('failure before inspect preserves profile while startup and late descendants remain alive',
  { skip: process.platform !== 'win32' }, async () => {
    const attempt = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-fg-test-'));
    let owner, stopped, safe = false;
    try {
      const executable = await compile(attempt, 'tree');
      owner = await launch({ executable, executableSha256: hash(await fs.readFile(executable)) }, attempt, true);
      await waitFor(() => present(path.join(attempt, 'child-started')));
      // No inspect RPC occurs: this is the renderer/presentation failure boundary.
      stopped = await owner.stop(); owner = null;
      assert.equal(stopped.stopped, true); assert.equal(stopped.forced, false); assert.equal(stopped.exitCode, 0);
      assert.equal(stopped.childrenSettled, false); assert.ok(stopped.remainingPids.length > 0);
      await assert.rejects(removeForegroundAttempt(attempt, stopped.stopped && stopped.childrenSettled), /Preserve profile/);
      assert.equal(await present(attempt), true);
      await waitFor(() => present(path.join(attempt, 'grandchild-started')));
    } finally {
      await fs.writeFile(path.join(attempt, 'release'), 'release');
      if (owner) stopped = await owner.stop();
      if (stopped) {
        // Read-only exit verification; no discovered PID is ever terminated.
        const ids = [await fs.readFile(path.join(attempt, 'child-started'), 'utf8'),
          await fs.readFile(path.join(attempt, 'grandchild-started'), 'utf8')];
        ps('foreach($value in $env:PROBE_PIDS.Split(",")) { ' +
          '$p=Get-Process -Id ([int]$value) -ErrorAction SilentlyContinue; ' +
          'if($p) { if(-not $p.WaitForExit([int]$env:PROBE_BUDGET)) { throw "Probe remains alive" }; $p.Dispose() } }; exit 0',
        { ...process.env, PROBE_PIDS: ids.join(','), PROBE_BUDGET: String(commandMs) });
        safe = true;
      }
      await removeForegroundAttempt(attempt, safe);
    }
  });
