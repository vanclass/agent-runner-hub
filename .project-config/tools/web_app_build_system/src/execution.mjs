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
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid local/settings.json: ' + error.message); }
  const value = { ...defaults, ...overrides };
  if (value.schema !== 1 || typeof value.allowDependencyInstall !== 'boolean') throw new Error('Build configuration requires schema 1 and boolean allowDependencyInstall.');
  return value;
}

export async function executeTarget(root, local, target, signal, stage, { prepare = false, prepareOnly = false, resultFile } = {}) {
  if (resultFile && (path.dirname(path.resolve(resultFile)) !== path.join(path.dirname(local), 'temp', 'invocations')
      || !/^[a-f0-9]{32}\.json$/.test(path.basename(resultFile)))) throw new Error('Invalid invocation result path.');
  const adapter = adapterFor(target);
  const config = await settings(local);
  return withBuildOwnership(root, path.join(root, '.project-config/managed/web-app-launch/cache'), signal, stage, async () => {
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
      const published = await publishResult(attempt, target, verified.integrity, verified.inputs, { before, after });
      if (resultFile) {
        await fs.mkdir(path.dirname(resultFile), { recursive: true });
        if (await fs.realpath(path.dirname(resultFile)) !== path.dirname(resultFile)) throw new Error('Indirect invocation path.');
        const receipt = JSON.stringify({ schema: 1, invocation: path.basename(resultFile, '.json'),
          result: path.join(published.location, 'result.json') }) + '\n';
        await fs.writeFile(resultFile + '.tmp', receipt, { flag: 'wx' });
        await fs.rename(resultFile + '.tmp', resultFile);
      }
      return published;
    } catch (error) {
      await discardResult(attempt);
      throw error;
    }
  }, true);
}
