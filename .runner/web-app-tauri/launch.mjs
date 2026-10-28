import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
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
    // Keep both MSVC outputs and the child working directory independent of checkout length.
    const attempt = process.platform === 'win32'
      ? await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), 'ar-tauri-'))
      : path.join(cache, randomUUID());
    if (process.platform !== 'win32') await fs.mkdir(attempt);
    const target = path.join(attempt, 'cargo');
    try {
      if (process.platform === 'win32' && target.length > 80) {
        throw new Error('Windows Tauri Cargo target exceeds 80 characters: ' + target
          + '. Use a shorter Windows TEMP directory and retry.');
      }
      const backend = path.join(attempt, 'src-tauri');
      const config = await stageBackend(root, backend);
      const frontend = path.join(attempt, 'frontend');
      // Drive-letter frontendDist values parse as URLs in Tauri; keep Windows assets relative.
      const override = ownedOverride(process.platform === 'win32' ? '../frontend' : frontend,
        process.platform === 'win32' ? undefined : origin,
        process.platform, config.app?.windows);
      if (process.platform === 'win32') {
        const destination = path.resolve(frontend, '.' + origin.base);
        if (destination !== frontend && !destination.startsWith(frontend + path.sep)) {
          throw new Error('Native frontend base must remain inside the staged assets.');
        }
        await fs.cp(origin.frontend, destination, { recursive: true });
        if (origin.base !== '/') override.app = { windows: (config.app?.windows || []).map(window => ({
          ...window, url: /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(window.url || '') ? window.url
            : origin.base.slice(1) + (window.url || 'index.html').replace(/^\/+/, ''),
        })) };
      }
      const developerEnvironment = await developmentEnvironment(root, config, environment.developerEnvironment);
      const env = await prepareCargo({ ...environment, developerEnvironment }, backend, target, signal, command);
      let result;
      if (process.platform === 'win32') {
        const metadata = await command(environment.cargo, ['metadata', '--no-deps', '--format-version', '1',
          '--manifest-path', path.join(backend, 'Cargo.toml')], backend, signal, { env });
        if (metadata.code !== 0 || metadata.truncated) throw new Error('Staged Cargo metadata failed: ' + metadata.output);
        const graph = JSON.parse(metadata.stdout);
        if (path.resolve(graph.target_directory) !== target) throw new Error('Cargo output escaped the launch target.');
        const pkg = graph.packages.find(item => path.resolve(item.manifest_path) === path.join(backend, 'Cargo.toml'));
        const binaries = pkg?.targets.filter(item => item.kind.includes('bin')) || [];
        const binary = config.mainBinaryName || pkg?.default_run || (binaries.length === 1 ? binaries[0].name : null);
        if (!binary || !binaries.some(item => item.name === binary) || /[/\\]/.test(binary)) {
          throw new Error('Native main binary identity is ambiguous. Resolve Cargo default-run/mainBinaryName and retry.');
        }
        stage('Building Tauri 2 application', 'Embedding the verified frontend without installer packaging; Ctrl+C cancels.');
        result = await command(process.execPath, [environment.cli, 'build', '--debug', '--no-bundle', '--ci',
          '--target', targetTriple, '--config', JSON.stringify(override), '--', '--locked'], backend, signal, { env, quiet: false });
        if (result.code === 0) {
          stage('Opening Tauri 2 window', 'Using native application storage. Close the window or press Ctrl+C to stop.');
          result = await command(path.join(target, targetTriple, 'debug', binary + '.exe'), [], backend, signal, { env, quiet: false });
        }
      } else {
        stage('Opening Tauri 2 window', 'Using the verified production frontend. Close the window or press Ctrl+C to stop.');
        result = await command(process.execPath, [environment.cli, 'dev', '--target', targetTriple,
          '--config', JSON.stringify(override), '--no-watch', '--', '--locked'], backend, signal, { env, quiet: false });
      }
      if (result.code !== 0) throw new Error('Tauri launch failed. Resolve native prerequisites/compiler output and retry; source and locks are preserved.');
    } finally {
      await fs.rm(attempt, { recursive: true, force: true,
        ...(process.platform === 'win32' ? { maxRetries: 5, retryDelay: 200 } : {}) });
    }
  });
}
