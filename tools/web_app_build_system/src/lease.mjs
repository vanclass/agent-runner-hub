import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const pollMilliseconds = 250; // Existing launcher wait/cancellation cadence.
const publicationAttempts = 8; // Publication grace bounds waiting, never authorizes deletion.
const processQueryMilliseconds = 10000; // Bound OS observation; expiry means unknown, never absent.
export function unsafe(lock, reason) {
  return new Error('Build lock recovery blocked: ' + reason + '. Lock: ' + lock
    + '. Inspect owner.json and process access. Let active builds finish. If owner and child writers are independently verified stopped, remove only this build.lock and retry; otherwise preserve it.');
}

export async function observeProcess(pid) {
  try {
    if (process.platform === 'win32') {
      // Read-only CIM query: process.kill(pid, 0) is not a Windows liveness probe.
      const command = "$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid
        + "'; if ($null -eq $p) { 'absent' } else { $s=Get-Process -Id $p.ProcessId -ErrorAction Stop; 'windows-filetime:' + $s.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() }";
      const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
        { encoding: 'utf8', windowsHide: true, timeout: processQueryMilliseconds });
      if (result.error || result.status !== 0) return { state: 'unknown' };
      const identity = result.stdout.trim();
      if (identity === 'absent') return { state: 'absent' };
      return /^windows-filetime:\d+$/.test(identity) ? { state: 'active', identity } : { state: 'unknown' };
    }
    if (process.platform === 'linux') {
      let stat;
      try { stat = await fs.readFile('/proc/' + pid + '/stat', 'utf8'); }
      catch (error) { return { state: error.code === 'ENOENT' ? 'absent' : 'unknown' }; }
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const boot = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      if (!/^\d+$/.test(fields[19]) || !boot) return { state: 'unknown' };
      return { state: 'active', identity: 'linux-boot-start:' + boot + ':' + fields[19] };
    }
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: processQueryMilliseconds });
    if (result.status === 1 && !result.stdout.trim()) return { state: 'absent' };
    // ps cannot provide Python's native microsecond creation identity. Keep recovery unverifiable.
    return result.status === 0 && result.stdout.trim() ? { state: 'active' } : { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

async function snapshot(lock) {
  const directory = await fs.lstat(lock, { bigint: true });
  if (!directory.isDirectory() || directory.isSymbolicLink() || await fs.realpath(lock) !== lock) throw unsafe(lock, 'indirect lock directory');
  const file = path.join(lock, 'owner.json');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw unsafe(lock, 'indirect owner metadata');
  const bytes = await fs.readFile(file, 'utf8');
  return { generation: [directory.dev, directory.ino, directory.birthtimeNs].join(':'), bytes, owner: JSON.parse(bytes) };
}

async function classification(root, owner) {
  if (!owner || owner.root !== root || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid > 0xffffffff
      || typeof owner.token !== 'string' || !owner.token.trim() || owner.token.length > 128) return 'invalid root, PID or token';
  if (Object.hasOwn(owner, 'schema') && (owner.schema !== 1 || !Number.isSafeInteger(owner.children)
      || owner.children < 0 || !(owner.processIdentity === null || typeof owner.processIdentity === 'string'))) return 'invalid extended owner metadata';
  const observed = await observeProcess(owner.pid);
  if (observed.state === 'active') {
    if (owner.processIdentity && !observed.identity) return 'process creation identity is unverifiable';
    if (owner.processIdentity && owner.processIdentity !== observed.identity) return 'PID reuse or process identity mismatch';
    return 'active';
  }
  if (observed.state !== 'absent') return 'process liveness is unverifiable';
  // Legacy records cannot attest to surviving children. Missing evidence is not abandonment.
  if (!owner.processIdentity || owner.schema !== 1 || owner.children !== 0) return 'owner exited; child-writer settlement is unverified';
  if (!/^(windows-filetime:\d+|linux-boot-start:[\w-]+:\d+|darwin-start:.+)$/.test(owner.processIdentity)) return 'invalid process identity';
  return 'abandoned';
}

async function removeGeneration(lock, expected, verify) {
  const guard = path.join(lock, 'recovery.guard');
  try { await fs.mkdir(guard); } catch (error) {
    if (['EEXIST', 'ENOENT'].includes(error.code)) return false;
    throw error;
  }
  const guardIdentity = await fs.lstat(guard, { bigint: true });
  try {
    const current = await snapshot(lock);
    if (current.generation !== expected.generation || current.bytes !== expected.bytes || !await verify(current.owner)) return false;
    const final = await snapshot(lock);
    if (final.generation !== expected.generation || final.bytes !== expected.bytes) return false;
    if ((await fs.readdir(lock)).some(name => !['owner.json', 'recovery.guard'].includes(name))) throw unsafe(lock, 'unexpected lock contents');
    // Delete only the exact metadata and empty directories, never cache/build artifacts.
    await fs.unlink(path.join(lock, 'owner.json'));
  } finally {
    const currentGuard = await fs.lstat(guard, { bigint: true }).catch(() => null);
    if (currentGuard?.ino === guardIdentity.ino && currentGuard?.dev === guardIdentity.dev) await fs.rmdir(guard);
  }
  try { await fs.rmdir(lock); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    return false;
  }
  return true;
}

export async function acquireLease(root, cache, signal, stage) {
  const lock = path.join(cache, 'build.lock');
  let incomplete = 0;
  while (true) {
    signal.throwIfAborted();
    try { await fs.mkdir(lock); break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    let prior;
    try { prior = await snapshot(lock); } catch (error) {
      if ((error.code === 'ENOENT' || error instanceof SyntaxError) && ++incomplete <= publicationAttempts) {
        await delay(pollMilliseconds, undefined, { signal }); continue;
      }
      throw unsafe(lock, 'owner metadata is incomplete, malformed or inaccessible');
    }
    const state = await classification(root, prior.owner);
    if (state === 'abandoned') {
      const removed = await removeGeneration(lock, prior, async owner => {
        signal.throwIfAborted();
        return await classification(root, owner) === 'abandoned';
      });
      if (removed) stage('Recovered abandoned checkout build lock', 'Continuing through normal exclusive build acquisition.');
      else throw unsafe(lock, 'lock generation changed or another recovery is in progress; retry');
      continue;
    }
    if (state !== 'active') throw unsafe(lock, state);
    incomplete = 0;
    await delay(pollMilliseconds, undefined, { signal });
  }
  const observed = await observeProcess(process.pid);
  const owner = { schema: 1, pid: process.pid, root, token: randomUUID(), processIdentity: observed.identity || null, children: 0 };
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
  return { lock, owner, generation: (await snapshot(lock)).generation };
}

export function childWriter(lease) {
  if (!lease) return () => {};
  const file = path.join(lease.lock, 'owner.json');
  const update = delta => {
    const owner = JSON.parse(readFileSync(file, 'utf8'));
    if (owner.token !== lease.owner.token || owner.root !== lease.owner.root) throw unsafe(lease.lock, 'writer lease changed');
    owner.children += delta;
    writeFileSync(file, JSON.stringify(owner));
  };
  update(1); // Publish uncertainty BEFORE spawning, including the spawn/publication gap.
  let finished = false;
  return () => { if (!finished) { update(-1); finished = true; } };
}

export async function releaseLease(lease) {
  let current;
  try { current = await snapshot(lease.lock); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (current.generation !== lease.generation || current.owner.token !== lease.owner.token) return;
  if (['root', 'pid', 'processIdentity'].some(key => current.owner[key] !== lease.owner[key])) return;
  if (current.owner.children !== 0) throw unsafe(lease.lock, 'child-writer settlement is unverified');
  const removed = await removeGeneration(lease.lock, current,
    async owner => ['root', 'pid', 'token', 'processIdentity'].every(key => owner[key] === lease.owner[key]));
  if (!removed) throw unsafe(lease.lock, 'lease changed or recovery guard is busy; lock preserved');
}
