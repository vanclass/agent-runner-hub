import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withBuildOwnership } from '../.runner/web-app-tauri/ownership.mjs';
import { npm } from '../.runner/web-app-tauri/project.mjs';
import { inspectNative, prepareNative, targetTriple } from '../.runner/web-app-tauri/native/environment.mjs';
import { stageBackend, ownedOverride, prepareCargo } from '../.runner/web-app-tauri/native/staging.mjs';
import { command } from '../.runner/web-app-tauri/native/process.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
const controller = new AbortController();
const events = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
const cancel = () => controller.abort(new Error('Hub native operation cancelled'));
const stage = (name, hint) => console.log(`[Hub native] ${name}\n  ${hint}`);

async function native(action, target, signal) {
  await withBuildOwnership(root, path.join(root, '.runner/web-app-launch/cache'), signal, stage, async () => {
    stage('Checking native environment', 'Reusing the installed Tauri host preparation; Ctrl+C cancels.');
    let environment = await inspectNative(root, signal);
    environment = await prepareNative(root, environment, signal, stage, true);
    const parent = path.join(root, 'temp/hub-native');
    await fs.mkdir(parent, { recursive: true });
    if (await fs.realpath(parent) !== parent) throw new Error('Hub staging must remain in this checkout.');
    const attempt = path.join(parent, randomUUID());
    await fs.mkdir(attempt);
    try {
      const frontend = path.join(attempt, 'frontend');
      stage('Building frontend', 'Using this checkout\'s existing build; previous dist remains intact.');
      if (await npm(environment.web.cli, ['run', 'build', '--', '--outDir', frontend, '--emptyOutDir', '--base', './'], root, signal) !== 0) {
        throw new Error('Hub frontend build failed');
      }
      const backend = path.join(attempt, 'src-tauri');
      const config = await stageBackend(root, backend);
      const env = await prepareCargo(environment, backend, target, signal, command);
      const metadata = await command(environment.cargo, ['metadata', '--no-deps', '--format-version', '1'], backend, signal, { env });
      if (metadata.code !== 0 || metadata.truncated || path.resolve(JSON.parse(metadata.stdout).target_directory) !== target) {
        throw new Error('Cargo did not resolve the requested output directory');
      }
      stage('Cargo output', target);
      if (action === 'test') {
        for (const verb of ['check', 'test']) {
          const result = await command(environment.cargo, [verb, '--target', targetTriple, '--locked',
            '--features', config.build.features.join(',')], backend, signal, { env, quiet: false });
          if (result.code !== 0) throw new Error(`cargo ${verb} failed`);
        }
      } else {
        // A Windows drive-letter path can deserialize as a URL instead of embedded assets.
        const distribution = path.relative(backend, frontend).split(path.sep).join('/');
        const override = ownedOverride(distribution, undefined, process.platform);
        const result = await command(process.execPath, [environment.cli, 'build', '--debug', '--no-bundle',
          '--target', targetTriple, '--config', JSON.stringify(override), '--', '--locked'], backend, signal, { env, quiet: false });
        if (result.code !== 0) throw new Error('Hub native build failed');
        const executable = path.join(target, targetTriple, 'debug', 'web-app-native' + (process.platform === 'win32' ? '.exe' : ''));
        await fs.access(executable);
        stage('Executable ready', executable);
        stage('Verification', 'Compilation only. Installed-Runner GUI acceptance and installer packaging are separate checks.');
      }
    } finally {
      await fs.rm(attempt, { recursive: true, force: true });
      await fs.rmdir(parent).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
    }
  });
}

try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node tools/hub-native.mjs <build|test> --target-dir <absolute Cargo output directory>\nUses the installed Tauri staging, feature selection, host preparation and checkout lease.\nUse a short real Cargo cache path on Windows. build produces a debug executable without an installer.');
  } else {
    if (args.length !== 3 || !['build', 'test'].includes(args[0]) || args[1] !== '--target-dir' || !path.isAbsolute(args[2])) {
      throw new Error('Use --help or <build|test> --target-dir <absolute directory>.');
    }
    for (const event of events) process.on(event, cancel);
    await native(args[0], path.resolve(args[2]), controller.signal);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  for (const event of events) process.removeListener(event, cancel);
}
