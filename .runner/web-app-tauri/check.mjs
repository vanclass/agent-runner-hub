import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withBuildOwnership } from './ownership.mjs';
import { inspectNative, prepareNative, targetTriple } from './native/environment.mjs';
import { stageBackend, prepareCargo } from './native/staging.mjs';
import { command } from './native/process.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
const controller = new AbortController();
const cancel = () => controller.abort(new Error('Rust checks cancelled'));
const events = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
for (const event of events) process.on(event, cancel);
const stage = (name, hint) => console.log('[Tauri checks] ' + name + '\n  ' + hint);
try {
  if (process.argv.length !== 2) throw new Error('Usage: node .runner/web-app-tauri/check.mjs');
  await withBuildOwnership(root, path.join(root, '.runner/web-app-launch/cache'), controller.signal, stage, async () => {
    let environment = await inspectNative(root, controller.signal);
    if (!environment.ready) environment = await prepareNative(root, environment, controller.signal, stage, true);
    const cache = path.join(root, '.runner/web-app-tauri/cache/check');
    await fs.mkdir(cache, { recursive: true });
    if (await fs.realpath(cache) !== cache) throw new Error('Rust check cache must be checkout-local');
    const attempt = path.join(cache, randomUUID());
    await fs.mkdir(attempt);
    try {
      const backend = path.join(attempt, 'src-tauri');
      const config = await stageBackend(root, backend);
      const env = await prepareCargo(environment, backend, path.join(attempt, 'cargo'), controller.signal, command);
      for (const action of ['check', 'test']) {
        stage('Running cargo ' + action, 'Checking the selected desktop features on ' + targetTriple + '; Ctrl+C cancels.');
        const result = await command(environment.cargo, [action, '--manifest-path', path.join(backend, 'Cargo.toml'),
          '--target', targetTriple, '--locked', ...(config.build?.features?.length ? ['--features', config.build.features.join(',')] : [])],
          backend, controller.signal, { env, quiet: false });
        if (result.code !== 0) throw new Error('cargo ' + action + ' failed; see compiler/test output');
      }
    } finally { await fs.rm(attempt, { recursive: true, force: true }); }
  });
} catch (error) { console.error(error.message); process.exitCode = controller.signal.aborted ? 130 : 1; }
finally { for (const event of events) process.removeListener(event, cancel); }
