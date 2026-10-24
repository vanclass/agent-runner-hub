import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withBuildOwnership } from './ownership.mjs';
import { configuration } from './project.mjs';
import { inspectNative, prepareNative, targetTriple } from './native/environment.mjs';
import { command } from './native/process.mjs';
import { startDevServer } from './native/dev-server.mjs';
import { stageBackend, ownedOverride, prepareCargo, developmentEnvironment } from './native/staging.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
const args = process.argv.slice(2);
const controller = new AbortController();
const signal = controller.signal;
const cancel = () => controller.abort(new Error('Native development cancelled.'));
for (const event of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) process.on(event, cancel);
const stage = (name, hint) => console.log('[Tauri development] ' + name + '\n  ' + hint);

try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Tauri 2 native development\n  npm run dev:tauri [-- --port <port>]\n  node .runner/web-app-tauri/dev.mjs --inspect\nUses an owned loopback Vite server and a staged backend snapshot; restart to pick up Rust edits. No Build System installation is required.');
  } else if (args.length === 1 && args[0] === '--inspect') {
    console.log(JSON.stringify(await inspectNative(root, signal), null, 2));
  } else {
    if (args.length && !(args.length === 2 && args[0] === '--port')) throw new Error('Use --help or --port <port>.');
    await withBuildOwnership(root, path.join(root, '.runner/web-app-launch/cache'), signal, stage, async () => {
      stage('Checking native development readiness', 'Checking the selected runtime and host tools; external installers require user action.');
      let environment = await inspectNative(root, signal);
      if (!environment.enabled || environment.verificationStatus === 'unavailable') throw new Error(environment.hints.join('\n'));
      if (!environment.ready) environment = await prepareNative(root, environment, signal, stage, true);
      const port = args.length ? Number(args[1]) : environment.recipe.runnerTauri.devPort;
      const cache = path.join(root, '.runner/web-app-tauri/cache/dev');
      await fs.mkdir(cache, { recursive: true });
      if (await fs.realpath(cache) !== cache) throw new Error('Native development cache must be a plain checkout directory.');
      const attempt = path.join(cache, randomUUID());
      await fs.mkdir(attempt);
      let server;
      try {
        const backend = path.join(attempt, 'src-tauri');
        const nativeConfig = await stageBackend(root, backend);
        const config = await configuration(root);
        const profile = await developmentEnvironment(root, nativeConfig, environment.developerEnvironment);
        const env = await prepareCargo({ ...environment, developerEnvironment: profile },
          backend, path.join(attempt, 'cargo'), signal, command);
        stage('Starting owned Vite server', 'Binding 127.0.0.1:' + port + ' with strict port and checkout readiness checks.');
        server = await startDevServer(root, port, signal);
        stage('Opening Tauri desktop window', 'Frontend edits reload from this checkout. Close the native window or press Ctrl+C to stop; the checkout build lease remains owned until cleanup.');
        const override = ownedOverride(config.output, server.origin, process.platform, nativeConfig.app?.windows);
        const result = await command(process.execPath, [environment.cli, 'dev', '--target', targetTriple,
          '--config', JSON.stringify(override), '--no-watch', '--', '--locked'], backend, signal, { env, quiet: false });
        if (result.code !== 0) throw new Error('Tauri development failed. Check the native compiler/WebView output; project source and original lockfiles are preserved.');
      } finally {
        await server?.close();
        await fs.rm(attempt, { recursive: true, force: true });
      }
    });
  }
} catch (error) {
  console.error('Tauri development ' + (signal.aborted ? 'cancelled' : 'failed') + ': ' + error.message);
  process.exitCode = signal.aborted ? 130 : 1;
} finally {
  for (const event of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) process.removeListener(event, cancel);
}
