import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildProbe } from './build.mjs';
import { platformAdapter } from './owner.mjs';
import { connectDriver, freePort } from './driver.mjs';
import { executeCase } from './lifecycle.mjs';
import { BlockedPrerequisite } from './case.mjs';
import { commandMs } from './limits.mjs';

const profileFolders = ['user', 'tmp', 'app-data', 'webview2'];
// Build/staging survives cases; each owned process gets a fresh data profile.
export async function createEnvironment(root, target, signal) {
  const invocationId = randomUUID();
  const evidenceDir = path.join(root, 'temp/native-probe', invocationId);
  await fs.mkdir(evidenceDir, { recursive: true });
  const attempt = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-native-'));
  let build, buildFailure, settled = true;
  try { platformAdapter(); build = await buildProbe(root, attempt, target, signal); }
  catch (error) { buildFailure = new BlockedPrerequisite('Native build prerequisite: ' + error.message); }
  return {
    evidenceDir,
    async run(spec) {
      let port, adapter;
      const caseDir = path.join(evidenceDir, spec.id);
      await fs.mkdir(caseDir, { recursive: true });
      return executeCase(spec, { invocationId, platform: process.platform, arch: process.arch,
        presentation: spec.presentation, executable: build?.executable,
        build, macOSRuntime: process.platform === 'darwin' ? 'executing on this host' : 'unverified',
        profile: path.join(attempt, 'app-data') }, {
        signal,
        async start() {
          if (!settled) throw new BlockedPrerequisite('Previous owned process has not settled');
          if (buildFailure) throw buildFailure;
          adapter = platformAdapter();
          port = await freePort();
          for (const name of [...profileFolders, 'user/roaming', 'user/local']) {
            await fs.mkdir(path.join(attempt, name), { recursive: true });
          }
          const owner = await adapter.startOwner(root, build.executable, attempt, port, commandMs, spec.presentation);
          settled = false;
          return { pid: owner.pid, initialPresentation: owner.initialPresentation,
            request: action => owner.request(action), async stop() {
            const result = await owner.stop();
            settled = result.stopped === true;
            return result;
          } };
        },
        connect: () => connectDriver(port),
        capture: browser => browser.saveScreenshot(path.join(caseDir, 'renderer.png')),
        async release() {
          assert.ok(settled, 'Native owner must settle before data cleanup');
          for (const name of profileFolders) await fs.rm(path.join(attempt, name),
            { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        },
        record: evidence => fs.writeFile(path.join(caseDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8')
      });
    },
    async close() {
      assert.ok(settled, 'Unsettled native process; preserving owned staging/profile');
      assert.equal(path.dirname(attempt), os.tmpdir());
      await fs.rm(attempt, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
  };
}
