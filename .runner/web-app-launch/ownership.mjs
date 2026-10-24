import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const leases = new Map();
export function buildEnvironment(root) {
  const token = leases.get(root);
  return token ? { ...process.env, RUNNER_WEB_APP_BUILD_LEASE: token } : process.env;
}

// Every dependency/output writer uses the existing checkout-local mkdir lease.
export async function withBuildOwnership(root, cache, signal, stage, work) {
  if (path.resolve(cache) !== path.join(root, '.runner/web-app-launch/cache')) {
    throw new Error('Build coordination must stay in this checkout.');
  }
  await fs.mkdir(cache, { recursive: true });
  if (await fs.realpath(cache) !== path.resolve(cache)) throw new Error('Build cache must be a plain checkout directory.');
  const lock = path.join(cache, 'build.lock');
  stage('Waiting for this checkout\'s build', 'Let the current build/preparation finish, or cancel with Ctrl+C.');
  while (true) {
    signal.throwIfAborted();
    try { await fs.mkdir(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await delay(250, undefined, { signal });
    }
  }
  const token = randomUUID();
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, root, token }));
    leases.set(root, token);
    return await work();
  } finally {
    leases.delete(root);
    await fs.rm(lock, { recursive: true, force: true });
  }
}
