import fs from 'node:fs/promises';
import path from 'node:path';
import { stageDesktop } from './desktop.mjs';

function mergeConfiguration(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = typeof value === 'object' && !Array.isArray(value)
      ? mergeConfiguration(result[key] || {}, value) : value;
  }
  return result;
}

export async function stageBackend(root, destination, { platform = process.platform === 'darwin' ? 'macos' : 'windows' } = {}) {
  const source = path.join(root, 'src-tauri');
  const manifests = [];
  // External workspaces/path dependencies need an explicit staging integration.
  if (await fs.access(path.join(root, 'Cargo.toml')).then(() => true, () => false)) {
    throw new Error('Custom Cargo workspace at the Web App root requires a staging integration; original workspace/lockfiles are preserved.');
  }
  async function copy(folder, output) {
    await fs.mkdir(output);
    for (const name of await fs.readdir(folder)) {
      if (folder === source && ['target', 'gen'].includes(name)) continue;
      const input = path.join(folder, name), target = path.join(output, name);
      const stat = await fs.lstat(input);
      if (stat.isSymbolicLink()) throw new Error('Custom native filesystem indirection requires a staging integration: ' + input);
      if (stat.isDirectory()) await copy(input, target);
      else if (stat.isFile()) {
        if (platform === 'android' && /\.(?:jks|keystore|p12|pfx)$/i.test(name)) {
          throw new Error('Signing credentials are excluded from Android local/test staging; integrate custom signing separately.');
        }
        await fs.copyFile(input, target, fs.constants.COPYFILE_EXCL);
        if (name === 'Cargo.toml') manifests.push(target);
      }
      else throw new Error('Unsupported native input: ' + input);
    }
  }
  await copy(source, destination);
  let config = JSON.parse(await fs.readFile(path.join(destination, 'tauri.conf.json'), 'utf8'));
  if (platform !== 'android') {
    const overlay = path.join(destination, platform === 'macos' ? 'tauri.macos.conf.json' : 'tauri.windows.conf.json');
    try {
      config = mergeConfiguration(config, JSON.parse(await fs.readFile(overlay, 'utf8')));
      // Fold the effective platform configuration once before owned development/feature overrides.
      await fs.unlink(overlay);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const hook of ['beforeDevCommand', 'beforeBuildCommand', 'beforeBundleCommand']) {
    if (config.build?.[hook]) throw new Error('Custom Tauri ' + hook + ' requires an explicit staging integration. Its source is preserved.');
  }
  if (config.bundle?.externalBin?.length || config.bundle?.resources
      || platform === 'windows' && config.bundle?.windows?.signCommand
      || platform === 'macos' && (config.bundle?.macOS?.signingIdentity || config.bundle?.macOS?.entitlements)) {
    throw new Error('Custom Tauri sidecars/resources/sign commands require a complete staging integration; native source is preserved.');
  }
  for (const file of manifests) {
    const manifest = await fs.readFile(file, 'utf8');
    for (const match of manifest.matchAll(/\b(?:path|build)\s*=\s*["']([^"']+)["']/g)) {
      const relative = path.relative(destination, path.resolve(path.dirname(file), match[1]));
      if (match[1].includes('\\') || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('External or escaped Cargo source paths require a staging integration; original dependencies/locks are preserved.');
      }
    }
  }
  await stageDesktop(root, destination, config, platform);
  if (platform !== 'android') await fs.writeFile(path.join(destination, 'tauri.conf.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}

export function ownedOverride(frontend, origin, platform = process.platform, windows = []) {
  return { build: { beforeDevCommand: null, beforeBuildCommand: null, beforeBundleCommand: null,
    frontendDist: frontend, ...(origin ? { devUrl: origin } : { devUrl: null }) },
    ...(platform === 'darwin' && origin ? { app: { windows: windows.map(window => ({ ...window, incognito: true })) } } : {}),
    bundle: platform === 'darwin'
      ? { active: true, targets: ['app', 'dmg'], macOS: { signingIdentity: null } }
      : { active: true, targets: ['nsis'], useLocalToolsDir: true } };
}

export async function developmentEnvironment(root, config, environment) {
  if (process.platform !== 'win32') return { ...environment };
  const windows = config.app?.windows || [];
  if (windows.some(window => window.dataDirectory)
      || new Set(windows.map(window => JSON.stringify([window.additionalBrowserArgs,
        window.browserExtensionsEnabled, window.scrollBarStyle]))).size > 1) {
    throw new Error('Custom WebView2 data directories/options require a development isolation integration; original window settings are preserved.');
  }
  let folder = root;
  for (const name of ['.runner', 'web-app-tauri', 'cache', 'webview2']) {
    folder = path.join(folder, name);
    let stat = await fs.lstat(folder).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) { await fs.mkdir(folder); stat = await fs.lstat(folder); }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(folder) !== folder) {
      throw new Error('The development WebView2 profile must be a plain checkout-local directory.');
    }
  }
  // Child-only supported WebView2 override; persistent data is never reset on cancellation.
  return { ...environment, WEBVIEW2_USER_DATA_FOLDER: folder };
}

export async function prepareCargo(environment, folder, target, signal, run) {
  const childEnvironment = { ...environment.developerEnvironment, CARGO_TARGET_DIR: target, ...(environment.rustToolchain
    ? { RUSTUP_TOOLCHAIN: environment.rustToolchain } : {}) };
  if (environment.allowDependencyInstall === false) childEnvironment.CARGO_NET_OFFLINE = 'true';
  const locked = await fs.access(path.join(folder, 'Cargo.lock')).then(() => true, () => false);
  if (!locked) {
    const result = await run(environment.cargo, ['generate-lockfile', '--manifest-path', path.join(folder, 'Cargo.toml')],
      folder, signal, { env: childEnvironment, quiet: false });
    if (result.code !== 0) throw new Error('Native lock resolution failed. Resolve Cargo access/dependencies; original project lockfiles are preserved.');
  }
  return childEnvironment;
}
