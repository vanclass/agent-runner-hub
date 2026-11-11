import fs from 'node:fs/promises';
import path from 'node:path';
import { stageBackend, prepareCargo } from '../native/staging.mjs';
import { treeHash } from '../project.mjs';
import { command } from '../native/process.mjs';
import { sdkEnvironment } from './sdk.mjs';
import { androidTarget } from './environment.mjs';

export const generatedOutput = key => {
  const parts = key.split('/');
  return parts.some(name => ['.gradle', '.idea', '.tauri'].includes(name))
    || parts.includes('build') && !parts.includes('src') || key === 'local.properties';
};
export async function androidSourceHash(root) {
  const folder = path.join(root, 'src-tauri/gen/android');
  if (!await fs.access(folder).then(() => true, () => false)) return 'absent';
  return treeHash(folder, generatedOutput);
}
function merge(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key] || {}, value) : value;
  }
  return result;
}

export async function stageAndroid(root, workspace, frontend) {
  const backend = path.join(workspace, 'src-tauri');
  let config = await stageBackend(root, backend, { platform: 'android' });
  const platform = path.join(backend, 'tauri.android.conf.json');
  try { config = merge(config, JSON.parse(await fs.readFile(platform, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(config.identifier || '')) {
    throw new Error('Android package identity must contain valid Java package segments. Supply an explicit user-owned tauri.android.conf.json identifier override or update your Tauri identifier before retrying; the existing desktop identity is preserved.');
  }
  for (const hook of ['beforeDevCommand', 'beforeBuildCommand', 'beforeBundleCommand']) {
    if (config.build?.[hook]) throw new Error('Custom Android Tauri hooks need an explicit staging integration; source is preserved.');
  }
  if (config.bundle?.resources || config.bundle?.externalBin?.length) throw new Error('Custom Android resources/sidecars require a staging integration.');
  config.build = { ...config.build, beforeDevCommand: null, beforeBuildCommand: null, beforeBundleCommand: null,
    devUrl: null, frontendDist: frontend };
  config.bundle = { ...config.bundle, targets: 'all' };
  delete config.bundle.windows;
  delete config.bundle.useLocalToolsDir;
  delete config.mainBinaryName;
  if (Array.isArray(config.bundle.icon)) config.bundle.icon = config.bundle.icon.filter(name => !name.endsWith('.ico'));
  // Windows configuration remains in the checkout; only this private native copy is adapted.
  await fs.writeFile(path.join(backend, 'tauri.conf.json'), JSON.stringify(config, null, 2) + '\n');
  await fs.rm(platform, { force: true });
  await fs.copyFile(path.join(root, 'package.json'), path.join(workspace, 'package.json'), fs.constants.COPYFILE_EXCL);
  const original = path.join(root, 'src-tauri/gen/android');
  const generated = path.join(backend, 'gen/android');
  if (await fs.access(original).then(() => true, () => false)) {
    async function copy(folder, destination, relative = '') {
      const stat = await fs.lstat(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Android project sources must be plain files/directories.');
      await fs.mkdir(destination, { recursive: true });
      for (const name of await fs.readdir(folder)) {
        const key = relative ? relative + '/' + name : name;
        if (generatedOutput(key)) continue;
        const input = path.join(folder, name), output = path.join(destination, name);
        const item = await fs.lstat(input);
        if (item.isSymbolicLink()) throw new Error('Custom Android project indirection needs an explicit staging integration.');
        if (/\.(?:jks|keystore)$/i.test(name)) throw new Error('Signing credentials are excluded from local/test staging. Keep keys private and use a separately authorized signing workflow.');
        if (item.isDirectory()) await copy(input, output, key);
        else if (item.isFile()) await fs.copyFile(input, output, fs.constants.COPYFILE_EXCL);
        else throw new Error('Unsupported Android project input: ' + input);
      }
    }
    await copy(original, generated);
  }
  return { backend, generated, config };
}

export async function androidCargo(environment, backend, target, signal, allowed) {
  const env = await prepareCargo({ ...environment, allowDependencyInstall: allowed,
    developerEnvironment: { ...environment.developerEnvironment,
      ...sdkEnvironment(environment.sdk, environment.jdk, environment.developerEnvironment?.PATH || process.env.PATH || ''),
      CARGO_BUILD_TARGET: androidTarget } }, backend, target, signal, command);
  const metadata = await command(environment.cargo, ['metadata', '--no-deps', '--format-version', '1',
    '--manifest-path', path.join(backend, 'Cargo.toml')], backend, signal, { env });
  if (metadata.code !== 0 || metadata.truncated) throw new Error('Android staged Cargo metadata failed; preserve custom workspaces/path dependencies and resolve their staging integration.');
  const graph = JSON.parse(metadata.stdout);
  if (path.resolve(graph.target_directory) !== target) throw new Error('Android Cargo output escaped the execution-specific target directory.');
  const pkg = graph.packages.find(item => path.resolve(item.manifest_path) === path.join(backend, 'Cargo.toml'));
  const tauri = pkg?.dependencies.filter(item => item.name === 'tauri' && !item.kind) || [];
  if (!tauri.length || tauri.some(item => !/^[~^=]?\s*2(?:\.(?:\d+|\*)){0,2}$/.test(item.req))) {
    throw new Error('The Android backend must explicitly declare compatible Tauri 2 dependencies.');
  }
  const libraries = pkg.targets.filter(item => item.crate_types?.includes('cdylib'));
  if (libraries.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(libraries[0].name)) {
    throw new Error('Android requires one cdylib Rust library with a Tauri mobile_entry_point run function. Apply the current managed runtime or integrate your custom backend explicitly; original sources and locks are preserved.');
  }
  return { env, library: libraries[0].name };
}
