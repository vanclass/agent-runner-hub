import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireLease, releaseLease, childWriter } from './lease.mjs';

const leases = new Map();
export function buildEnvironment(root) {
  const token = leases.get(root)?.owner.token;
  return token ? { ...process.env, RUNNER_WEB_APP_BUILD_LEASE: token } : process.env;
}

export function buildWriter(root) { return childWriter(leases.get(root)); }

// Every dependency/output writer uses the existing checkout-local mkdir lease.
export async function withBuildOwnership(root, cache, signal, stage, work, childWriters = false) {
  if (path.resolve(cache) !== path.join(root, '.runner/web-app-launch/cache')) {
    throw new Error('Build coordination must stay in this checkout.');
  }
  await fs.mkdir(cache, { recursive: true });
  if (await fs.realpath(cache) !== path.resolve(cache)) throw new Error('Build cache must be a plain checkout directory.');
  stage('Waiting for this checkout\'s build', 'Let the current build/preparation finish, or cancel with Ctrl+C.');
  const lease = await acquireLease(root, cache, signal, stage);
  try {
    leases.set(root, lease);
    signal.throwIfAborted();
    const settled = childWriters ? buildWriter(root) : () => {};
    try { return await work(); } finally { settled(); }
  } finally {
    leases.delete(root);
    await releaseLease(lease);
  }
}
