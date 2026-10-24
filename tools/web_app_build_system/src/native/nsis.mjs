import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { command } from './process.mjs';

const zipSource = {
  url: 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip',
  sha256: 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1',
};
const pluginSource = {
  url: 'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll',
  sha256: '5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709',
};
const pluginPath = 'Plugins/x86-unicode/additional/nsis_tauri_utils.dll';
const requiredFiles = ['makensis.exe', 'Bin/makensis.exe', 'Stubs/lzma-x86-unicode',
  'Stubs/lzma_solid-x86-unicode', pluginPath, 'Include/MUI2.nsh', 'Include/FileFunc.nsh',
  'Include/x64.nsh', 'Include/nsDialogs.nsh', 'Include/WinMessages.nsh',
  'Include/Win/COM.nsh', 'Include/Win/Propkey.nsh', 'Include/Win/RestartManager.nsh'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function archiveFiles(bytes) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Unsupported NSIS ZIP directory.');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const files = new Map(), names = new Set();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid NSIS ZIP record.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const external = bytes.readUInt32LE(offset + 38), local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
    offset += 46 + length + extra + comment;
    if (!name.startsWith('nsis-3.11/') || name.includes('\\') || name.includes(':')
        || name.split('/').includes('..') || ((external >>> 16) & 0xf000) === 0xa000 || flags & 1) {
      throw new Error('Unsupported NSIS archive destination: ' + name);
    }
    const relative = name.slice('nsis-3.11/'.length);
    if (!relative || relative.endsWith('/')) continue;
    if (names.has(relative.toLowerCase())) throw new Error('Duplicate NSIS ZIP destination.');
    names.add(relative.toLowerCase());
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid NSIS ZIP local record.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.length) throw new Error('Truncated NSIS ZIP data.');
    const payload = bytes.subarray(start, start + compressed);
    const content = method === 0 ? payload : method === 8 ? inflateRawSync(payload) : null;
    if (!content || content.length !== size) throw new Error('Unsupported NSIS ZIP compression/content.');
    files.set(relative, content);
  }
  return files;
}

function trustedFiles(zip, plugin) {
  if (sha256(zip) !== zipSource.sha256 || sha256(plugin) !== pluginSource.sha256) throw new Error('NSIS package integrity mismatch.');
  const files = archiveFiles(zip);
  files.set(pluginPath, plugin);
  if (requiredFiles.some(name => !files.get(name)?.length)) throw new Error('NSIS package is incomplete.');
  return files;
}

async function verifyDirectory(folder, files, signal) {
  if (await fs.realpath(folder) !== path.resolve(folder)) throw new Error('NSIS tools must use a plain owned directory.');
  const found = new Set();
  async function visit(directory, prefix = '') {
    signal.throwIfAborted();
    for (const name of await fs.readdir(directory)) {
      const relative = prefix + name, target = path.join(directory, name);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new Error('NSIS tool tree has filesystem indirection.');
      if (stat.isDirectory()) await visit(target, relative + '/');
      else if (stat.isFile() && files.has(relative) && (await fs.readFile(target)).equals(files.get(relative))) found.add(relative);
      else throw new Error('NSIS tool file differs from its pinned package: ' + relative);
    }
  }
  await visit(folder);
  if (found.size !== files.size) throw new Error('NSIS tool tree has missing pinned files.');
}

async function verifyCache(cache, root, signal, folder = path.join(cache, 'NSIS')) {
  const zip = await fs.readFile(path.join(cache, 'nsis-3.11.zip'));
  const plugin = await fs.readFile(path.join(cache, 'nsis_tauri_utils.dll'));
  const files = trustedFiles(zip, plugin);
  await verifyDirectory(folder, files, signal);
  const version = await command(path.join(folder, 'makensis.exe'), ['/VERSION'], root, signal);
  if (version.code !== 0 || !/^v?3\.11\s*$/.test(version.stdout)) throw new Error('Pinned NSIS compiler /VERSION did not report 3.11. Check application-control/permissions.');
  return { cache, folder, integrity: sha256(zipSource.sha256 + pluginSource.sha256), version: '3.11' };
}

export async function inspectNsis(root, signal) {
  const cache = path.join(root, '.runner/web-app-tauri/cache/nsis');
  try { return { ready: true, ...await verifyCache(cache, root, signal) }; }
  catch (error) {
    signal.throwIfAborted();
    return { ready: false, cache, hint: 'Prepare pinned NSIS 3.11 packaging tools in the project-owned cache (HTTPS and local write permission required): ' + error.message };
  }
}

async function download(source, signal) {
  const response = await fetch(source.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  if (!response.ok) throw new Error('NSIS download failed: HTTP ' + response.status + '. Check HTTPS/proxy access and retry Prepare.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.sha256) throw new Error('NSIS download integrity check failed; no package was published.');
  return bytes;
}

export async function prepareNsis(root, signal, stage, allowed) {
  const current = await inspectNsis(root, signal);
  if (current.ready) return current;
  if (!allowed) throw new Error('NSIS acquisition requires allowDependencyInstall; prepare compatible pinned tools yourself or enable permitted installation.');
  stage('Preparing NSIS', 'Downloading and verifying pinned portable packaging tools; no installer/elevation or license-consent switch is invoked. Ctrl+C cancels.');
  const parent = path.dirname(current.cache);
  await fs.mkdir(parent, { recursive: true });
  if (await fs.realpath(parent) !== parent) throw new Error('NSIS cache must be a plain checkout directory.');
  const attempt = path.join(parent, 'nsis-preparing-' + randomUUID());
  const backup = path.join(parent, 'nsis-previous-' + randomUUID());
  await fs.mkdir(attempt);
  let backedUp = false, published = false;
  try {
    const zip = await download(zipSource, signal);
    const plugin = await download(pluginSource, signal);
    const files = trustedFiles(zip, plugin);
    await fs.writeFile(path.join(attempt, 'nsis-3.11.zip'), zip, { flag: 'wx' });
    await fs.writeFile(path.join(attempt, 'nsis_tauri_utils.dll'), plugin, { flag: 'wx' });
    for (const [name, content] of files) {
      const target = path.join(attempt, 'NSIS', name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: 'wx' });
    }
    await verifyCache(attempt, root, signal);
    signal.throwIfAborted();
    try { await fs.rename(current.cache, backup); backedUp = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(attempt, current.cache);
    published = true;
    const verified = await inspectNsis(root, signal);
    if (!verified.ready) throw new Error(verified.hint);
    if (backedUp) {
      try { await fs.rm(backup, { recursive: true }); }
      catch { stage('NSIS tools ready', 'Previous owned cache cleanup remains at ' + backup + '; the verified current tools are available.'); }
      backedUp = false;
    }
    return verified;
  } catch (error) {
    if (published) await fs.rm(current.cache, { recursive: true, force: true });
    if (backedUp) await fs.rename(backup, current.cache);
    throw error;
  } finally {
    await fs.rm(attempt, { recursive: true, force: true });
  }
}

export async function copyNsis(environment, targetDirectory, root, signal) {
  if (!environment.nsis?.ready) throw new Error('Prepare verified NSIS tools before packaging.');
  const destination = path.join(targetDirectory, '.tauri/NSIS');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(environment.nsis.folder, destination, { recursive: true, errorOnExist: true, force: false });
  await verifyCache(environment.nsis.cache, root, signal, destination);
}
