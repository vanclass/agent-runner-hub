import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withBuildOwnership } from './ownership.mjs';
import { inspectNative, prepareNative, targetTriple } from './native/environment.mjs';
import { command } from './native/process.mjs';
import { stageBackend, ownedOverride, prepareCargo, developmentEnvironment } from './native/staging.mjs';

export async function launch(root, origin, signal, stage) {
  return withBuildOwnership(root, path.join(root, '.runner/web-app-launch/cache'), signal, stage, async () => {
    let environment = await inspectNative(root, signal);
    if (!environment.ready) environment = await prepareNative(root, environment, signal, stage, true);
    const cache = path.join(root, '.runner/web-app-tauri/cache/launch');
    await fs.mkdir(cache, { recursive: true });
    if (await fs.realpath(cache) !== cache) throw new Error('Native launch cache must be a plain checkout directory.');
    const attempt = path.join(cache, randomUUID());
    await fs.mkdir(attempt);
    try {
      const backend = path.join(attempt, 'src-tauri');
      const config = await stageBackend(root, backend);
      const developerEnvironment = await developmentEnvironment(root, config, environment.developerEnvironment);
      const env = await prepareCargo({ ...environment, developerEnvironment }, backend, path.join(attempt, 'cargo'), signal, command);
      stage('Opening Tauri 2 window', 'Using the verified production frontend. Close the window or press Ctrl+C to stop.');
      const result = await command(process.execPath, [environment.cli, 'dev', '--target', targetTriple,
        '--config', JSON.stringify(ownedOverride(path.join(attempt, 'frontend'), origin, process.platform, config.app?.windows)),
        '--no-watch', '--', '--locked'], backend, signal, { env, quiet: false });
      if (result.code !== 0) throw new Error('Tauri launch failed. Resolve native prerequisites/compiler output and retry; source and locks are preserved.');
    } finally { await fs.rm(attempt, { recursive: true, force: true }); }
  });
}
