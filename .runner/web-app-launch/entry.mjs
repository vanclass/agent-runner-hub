import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultTarget } from './target.mjs';
import { currentBuild } from './build.mjs';
import { preview, openBrowser } from './preview.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
const cache = fileURLToPath(new URL('./cache/', import.meta.url));
const controller = new AbortController();
let currentStage = 'Starting launcher';
let nextAction = 'Check Node.js and project files, then retry.';
let server;
let snapshot;
let stop;
const stopped = new Promise(resolve => { stop = resolve; });
function cancel(signal) {
  if (!controller.signal.aborted) {
    controller.abort(new Error('Launcher stopped (' + signal + ').'));
    process.exitCode = signal === 'Quit' ? 0 : 130;
    stop();
  }
}
const handlers = new Map(['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]
  .map(signal => [signal, () => cancel(signal)]));
for (const [signal, handler] of handlers) process.on(signal, handler);
const input = data => { if (data.toString().trim().toLowerCase() === 'q') cancel('Quit'); };
function stage(name, action) {
  currentStage = name;
  nextAction = action;
  console.log('[Web App] ' + name + '...');
}
try {
  if (process.argv.length > 2) throw new Error('This launcher takes no arguments.');
  console.log('[Web App] Project: ' + root);
  const target = await defaultTarget(root);
  const nativeAssets = target === 'tauri' && process.platform === 'win32';
  const build = await currentBuild(root, cache, controller.signal, stage);
  snapshot = build.snapshot;
  controller.signal.throwIfAborted();
  if (!nativeAssets) {
    stage(target === 'browser' ? 'Starting browser preview' : 'Starting desktop preview', 'Check loopback access and your selected runtime, then retry.');
    server = await preview(snapshot, build.base, { spa: build.foundation !== 'AstroTS' });
  }
  controller.signal.throwIfAborted();
  stage(target === 'browser' ? 'Opening browser' : 'Opening desktop runtime', 'Check your selected runtime prerequisites or choose Browser with target.mjs.');
  if (target === 'browser') await openBrowser(server.url);
  if (server) console.log('[Web App] ' + (target === 'browser' ? 'Application ready: ' : 'Desktop preview ready: ') + server.url);
  console.log('[Web App] Keep this launcher open. Press Ctrl+C or type q then Enter to stop.');
  process.stdin.on('data', input);
  process.stdin.resume();
  if (target !== 'browser') {
    const native = await import(pathToFileURL(root + '/.runner/web-app-' + target + '/launch.mjs'));
    await native.launch(root, nativeAssets ? { frontend: snapshot + '/app', base: build.base } : server.url,
      controller.signal, stage);
    cancel('Quit');
  }
  await stopped;
} catch (error) {
  if (!controller.signal.aborted) {
    console.error('[Web App] ' + currentStage + ' failed: ' + error.message);
    console.error('[Web App] Next step: ' + nextAction);
    process.exitCode = 1;
  } else if (!controller.signal.reason.message.includes('(Quit)')) {
    process.exitCode = 130;
  }
} finally {
  process.stdin.removeListener('data', input);
  process.stdin.pause();
  try {
    if (server) await server.close();
    if (snapshot) await fs.rm(snapshot, { recursive: true, force: true });
    console.log('[Web App] Owned preview resources closed.');
  } catch (error) {
    console.error('[Web App] Cleanup failed: ' + error.message + '. Close this launcher and retry.');
    process.exitCode = 1;
  }
  for (const [signal, handler] of handlers) process.removeListener(signal, handler);
}
