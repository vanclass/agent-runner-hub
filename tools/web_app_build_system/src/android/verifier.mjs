import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { command } from '../native/process.mjs';

function cacheRoot() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'WebAppBuildSystem/android');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Caches/WebAppBuildSystem/android');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'web-app-build-system/android');
}
function valid(bytes, policy) {
  return bytes.length === policy.size && createHash('sha256').update(bytes).digest('hex') === policy.sha256;
}
export async function inspectVerifier(root, jdk, policy, signal) {
  const file = path.join(cacheRoot(), 'bundletool-' + policy.version + '.jar');
  let ready = false;
  try {
    const stat = await fs.lstat(file);
    ready = stat.isFile() && !stat.isSymbolicLink() && valid(await fs.readFile(file), policy);
    if (ready && jdk.ready) {
      const result = await command(jdk.java, ['-jar', file, 'version'], root, signal);
      ready = result.code === 0 && result.stdout === policy.version;
    }
  } catch { signal.throwIfAborted(); ready = false; }
  return { ready, file, version: ready ? policy.version : undefined };
}
export async function prepareVerifier(root, jdk, policy, signal, stage) {
  const inspected = await inspectVerifier(root, jdk, policy, signal);
  if (inspected.ready) return inspected;
  stage('Preparing AAB verifier', 'Downloading checksum-verified Google bundletool for read-only validation into the shared user cache; Ctrl+C cancels.');
  const parent = path.dirname(inspected.file);
  await fs.mkdir(parent, { recursive: true });
  if (await fs.realpath(parent) !== path.resolve(parent)) throw new Error('AAB verifier cache must be a plain user-owned directory.');
  const temporary = path.join(parent, '.bundletool-' + randomUUID() + '.jar');
  try {
    const response = await fetch(policy.url, { signal });
    if (!response.ok) throw new Error('AAB verifier download failed: HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes, policy)) throw new Error('AAB verifier checksum/size verification failed.');
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    const test = await command(jdk.java, ['-jar', temporary, 'version'], root, signal);
    if (test.code !== 0 || test.stdout !== policy.version) throw new Error('Selected JDK cannot run the verified AAB verifier.');
    signal.throwIfAborted();
    await fs.rename(temporary, inspected.file);
  } finally { await fs.rm(temporary, { force: true }); }
  const current = await inspectVerifier(root, jdk, policy, signal);
  if (!current.ready) throw new Error('AAB verifier preparation did not establish readiness.');
  return current;
}
