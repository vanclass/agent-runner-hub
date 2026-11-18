import fs from 'node:fs/promises';
import path from 'node:path';
import { withBuildOwnership } from '../../../.project-config/managed/web-app-tauri/ownership.mjs';
import { inspectNative, prepareNative, targetTriple } from '../../../.project-config/managed/web-app-tauri/native/environment.mjs';
import { stageBackend, ownedOverride, prepareCargo } from '../../../.project-config/managed/web-app-tauri/native/staging.mjs';
import { command } from '../../../.project-config/managed/web-app-tauri/native/process.mjs';
import { npm } from '../../../.project-config/managed/web-app-tauri/project.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { bootSource, hash, payload } from './bootstrap.mjs';

export async function inventory(folder) {
  const files = {};
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(folder, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Fixture assets must not contain indirection');
      if (entry.isDirectory()) await visit(name);
      else files[name] = hash(await fs.readFile(path.join(folder, name)));
    }
  }
  await visit(''); return files;
}

export async function buildForeground(root, attempt, target, invocation, synthetic, signal) {
  return withBuildOwnership(root, path.join(root, '.project-config/managed/web-app-launch/cache'), signal,
    (stage, hint) => console.log(stage + ': ' + hint), async () => {
      let environment = await inspectNative(root, signal);
      environment = await prepareNative(root, environment, signal, console.log, true);
      const frontend = path.join(attempt, 'frontend');
      if (await npm(environment.web.cli, ['run', 'build', '--', '--outDir', frontend, '--emptyOutDir', '--base', './'], root, signal))
        throw new Error('Foreground frontend build failed');
      const ordinaryAssets = await inventory(frontend);
      const fixture = synthetic ? payload() : null;
      await fs.writeFile(path.join(frontend, 'foreground-boot.js'), bootSource(invocation, fixture, startupMs), 'utf8');
      const html = path.join(frontend, 'index.html'), original = await fs.readFile(html, 'utf8');
      if (!original.includes('<head>')) throw new Error('Expected packaged frontend head');
      await fs.writeFile(html, original.replace('<head>', '<head>\n<script src="./foreground-boot.js"></script>'), 'utf8');
      const stagedAssets = await inventory(frontend);
      const backend = path.join(attempt, 'src-tauri'), config = await stageBackend(root, backend);
      const features = config.build?.features ?? [];
      if (!features.includes('desktop-terminal') || features.includes('native-webdriver'))
        throw new Error('Foreground fixture requires the ordinary desktop feature graph');
      const env = await prepareCargo(environment, backend, target, signal, command);
      const graph = await command(environment.cargo, ['tree', '--locked', '-e', 'normal', '--depth', '1',
        '--features', features.join(',')], backend, signal, { env });
      if (graph.code || graph.truncated || graph.stdout.includes('tauri-plugin-wdio'))
        throw new Error('Ordinary graph must exclude WebDriver');
      const override = ownedOverride('../frontend', undefined, 'win32');
      override.bundle = { active: false };
      override.app = { appDirectoriesOverride: path.join(attempt, 'app-data'), windows: [
        { ...config.app.windows[0], title: 'AgentRunnerHub foreground fixture',
          visible: false, focus: false, focusable: true, center: true }
      ] };
      const built = await command(process.execPath, [environment.cli, 'build', '--debug', '--no-bundle',
        '--target', targetTriple, '--config', JSON.stringify(override), '--', '--locked'], backend, signal, { env, quiet: false });
      if (built.code) throw new Error('Foreground ordinary native build failed');
      const executable = path.join(target, targetTriple, 'debug/web-app-native.exe');
      return { executable, executableSha256: hash(await fs.readFile(executable)), features, graph: graph.stdout,
        versions: environment.versions, ordinaryAssets, stagedAssets, override, fixture: fixture?.image,
        sourceHead: (await command('git', ['rev-parse', 'HEAD'], root, signal)).stdout };
    });
}
