import fs from 'node:fs/promises';
import path from 'node:path';
import { withBuildOwnership } from '../../.project-config/managed/web-app-tauri/ownership.mjs';
import { inspectNative, prepareNative, targetTriple } from '../../.project-config/managed/web-app-tauri/native/environment.mjs';
import { stageBackend, ownedOverride, prepareCargo } from '../../.project-config/managed/web-app-tauri/native/staging.mjs';
import { npm } from '../../.project-config/managed/web-app-tauri/project.mjs';
import { command } from '../../.project-config/managed/web-app-tauri/native/process.mjs';

// Reuse managed preparation/staging; only the application-owned test overlay differs.
export async function buildProbe(root, attempt, target, signal) {
  let result;
  await withBuildOwnership(root, path.join(root, '.project-config/managed/web-app-launch/cache'), signal,
    (name, hint) => console.log(`[native probe] ${name}: ${hint}`), async () => {
      let environment = await inspectNative(root, signal);
      environment = await prepareNative(root, environment, signal, console.log, true);
      const frontend = path.join(attempt, 'frontend');
      if (await npm(environment.web.cli, ['run', 'build', '--', '--outDir', frontend, '--emptyOutDir', '--base', './'], root, signal)) {
        throw new Error('Native probe frontend build failed');
      }
      const backend = path.join(attempt, 'src-tauri');
      const config = await stageBackend(root, backend);
      const env = await prepareCargo(environment, backend, target, signal, command);
      const tree = await command(environment.cargo, ['tree', '--locked', '-e', 'normal', '--depth', '1', '--features', config.build.features.join(',')], backend, signal, { env });
      if (tree.code || tree.truncated || tree.stdout.includes('tauri-plugin-wdio')) {
        throw new Error('Ordinary dependency graph must exclude WebDriver');
      }
      const overlay = JSON.parse(await fs.readFile(path.join(root, 'tests/native/webdriver/tauri.test.json'), 'utf8'));
      const distribution = path.relative(backend, frontend).split(path.sep).join('/');
      const override = ownedOverride(distribution, undefined, process.platform);
      override.bundle = overlay.bundle;
      override.build.features = [...config.build.features, 'native-webdriver'];
      override.app = { ...overlay.app, appDirectoriesOverride: path.join(attempt, 'app-data') };
      if (process.platform === 'darwin') override.app.windows = override.app.windows.map(w => ({ ...w, incognito: true }));
      // CLI configuration changes are staged only; original config/locks are preserved.
      const built = await command(process.execPath, [environment.cli, 'build', '--debug', '--no-bundle',
        '--target', targetTriple, '--config', JSON.stringify(override), '--', '--locked'], backend, signal, { env, quiet: false });
      if (built.code) throw new Error('Native probe build failed');
      const ordinary = await command(environment.cargo, ['check', '--lib', '--target', targetTriple,
        '--locked', '--features', config.build.features.join(',')], backend, signal, { env, quiet: false });
      if (ordinary.code) throw new Error('Ordinary native library check failed');
      result = { executable: path.join(target, targetTriple, 'debug', 'web-app-native' + (process.platform === 'win32' ? '.exe' : '')),
        ordinaryGraphExcludesWebdriver: true, features: override.build.features };
      await fs.access(result.executable);
    });
  return result;
}
