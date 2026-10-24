import fs from 'node:fs/promises';
import path from 'node:path';
import { withBuildOwnership } from './ownership.mjs';
import { adapterFor } from './targets.mjs';
import { beginResult, publishResult, discardResult } from './output.mjs';
import { captureReleaseInputs } from './release-evidence.mjs';

export async function settings(local) {
  const defaults = JSON.parse(await fs.readFile(new URL('../config.json', import.meta.url), 'utf8'));
  let overrides = {};
  try { overrides = JSON.parse(await fs.readFile(path.join(local, 'settings.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid .local/settings.json: ' + error.message); }
  const value = { ...defaults, ...overrides };
  if (value.schema !== 1 || typeof value.allowDependencyInstall !== 'boolean') throw new Error('Build configuration requires schema 1 and boolean allowDependencyInstall.');
  return value;
}

export async function executeTarget(root, local, target, signal, stage, { prepare = false, prepareOnly = false } = {}) {
  const adapter = adapterFor(target);
  const config = await settings(local);
  return withBuildOwnership(root, path.join(root, '.runner/web-app-launch/cache'), signal, stage, async () => {
    stage('Checking environment', 'Validating Node/npm and exact project dependencies.');
    let environment = await adapter.inspect(root, signal);
    if (environment.verificationStatus === 'unavailable') {
      throw new Error('Implemented target; native verification unavailable. ' + environment.hints.join('; '));
    }
    if (!environment.ready) {
      if (!prepare && !prepareOnly) throw new Error('Environment Preparation Required: ' + environment.hints.join('\n') + '\nChoose Prepare Environment.');
      environment = await adapter.prepare(root, environment, signal, stage, config.allowDependencyInstall);
    }
    if (prepareOnly) return { verificationStatus: 'environment-ready' };
    signal.throwIfAborted();
    const attempt = await beginResult(local);
    try {
      const before = await captureReleaseInputs(root, target);
      const verified = await adapter.build({ root, output: attempt.output, environment, signal, stage, config });
      signal.throwIfAborted();
      if (verified.verificationStatus !== 'verified' || !/^[a-f0-9]{64}$/.test(verified.integrity)
          || !/^[a-f0-9]{64}$/.test(verified.inputs)) throw new Error('Adapter did not return verified product evidence.');
      const after = await captureReleaseInputs(root, target);
      return await publishResult(attempt, target, verified.integrity, verified.inputs, { before, after });
    } catch (error) {
      await discardResult(attempt);
      throw error;
    }
  });
}
