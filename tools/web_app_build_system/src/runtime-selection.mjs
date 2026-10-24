import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withBuildOwnership } from './ownership.mjs';

const labels = { browser: 'Browser', tauri: 'Tauri 2', electron: 'Electron' };
export async function runtimeEnabled(root, runtime, buildSystem = false) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.runner/project.json'), 'utf8'));
    if (manifest.schema_version !== 1 || manifest.kind !== 'project_management') return false;
    const child = (state, group, option) => state?.components?.some(c => c.component_id === 'WebApp'
      && c.children?.some(item => state === manifest.desired
        ? item.group_id === group && item.options?.some(o => o.option_id === option)
        : item.group_id === group && item.option_id === option));
    return child(manifest.desired, 'Runtimes', runtime) && child(manifest.applied, 'Runtimes', runtime)
      && (!buildSystem || (child(manifest.desired, 'Tools', 'WebAppBuildSystem')
        && child(manifest.applied, 'Tools', 'WebAppBuildSystem')));
  } catch { return false; }
}

export async function availableTarget(root, target) {
  if (target === 'browser') return true;
  if (!['tauri', 'electron'].includes(target)) return false;
  if (target === 'electron' && (!['win32', 'darwin', 'linux'].includes(process.platform)
      || !['x64', 'arm64'].includes(process.arch))) return false;
  if (target === 'tauri' && !(process.platform === 'win32' && process.arch === 'x64'
      || process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch))) return false;
  const identity = target === 'tauri' ? 'Tauri2' : 'Electron';
  const folder = path.join(root, '.runner/web-app-' + target);
  return await runtimeEnabled(root, identity) && await fs.stat(path.join(folder, 'launch.mjs')).then(s => s.isFile(), () => false);
}

export async function defaultTarget(root) {
  let value;
  try { value = JSON.parse(await fs.readFile(path.join(root, '.runner/web-app-launch/settings.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return 'browser'; throw new Error('Invalid launch settings: ' + error.message); }
  if (value.schema !== 1 || !Object.hasOwn(labels, value.defaultTarget)) throw new Error('Launch settings require schema 1 and one defaultTarget: browser, tauri or electron.');
  if (!await availableTarget(root, value.defaultTarget)) throw new Error(labels[value.defaultTarget] + ' default launch target is unavailable. Apply its compatible runtime, or select browser using node .runner/web-app-launch/target.mjs browser.');
  return value.defaultTarget;
}

export async function selectTarget(root, target, signal = new AbortController().signal) {
  if (!Object.hasOwn(labels, target) || !await availableTarget(root, target)) throw new Error('Unavailable launch target: ' + target + '. Choose Browser or Apply a compatible runtime in Project Settings.');
  const folder = path.join(root, '.runner/web-app-launch');
  return withBuildOwnership(root, path.join(folder, 'cache'), signal, () => {}, async () => {
    await fs.mkdir(folder, { recursive: true });
    if (await fs.realpath(folder) !== folder) throw new Error('Launch settings require a plain checkout directory.');
    const destination = path.join(folder, 'settings.json');
    if (await fs.realpath(destination).then(p => p !== destination, e => { if (e.code !== 'ENOENT') throw e; return false; })) throw new Error('Launch settings cannot use filesystem indirection.');
    const temporary = path.join(folder, 'cache', randomUUID() + '.json');
    try {
      await fs.writeFile(temporary, JSON.stringify({ schema: 1, defaultTarget: target }, null, 2) + '\n', { flag: 'wx' });
      await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }); }
    return target;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] !== '--list') {
      console.log('Default launch target: ' + labels[await selectTarget(root, args[0])]);
    } else if (!args.length || (args.length === 1 && args[0] === '--list')) {
      console.log('Default launch target: ' + labels[await defaultTarget(root)]);
      for (const [target, label] of Object.entries(labels)) console.log(label + ': ' + (await availableTarget(root, target) ? 'available' : 'unavailable'));
      console.log('Select one: node .runner/web-app-launch/target.mjs browser|tauri|electron');
    } else throw new Error('Use --list or one target: browser, tauri, electron.');
  } catch (error) { console.error('Launch target selection failed: ' + error.message); process.exitCode = 1; }
}
