import fs from 'node:fs/promises';
import path from 'node:path';
import { withBuildOwnership } from './ownership.mjs';
import { adapterFor, preparationBlock } from './targets.mjs';
import { beginResult, publishResult, discardResult } from './output.mjs';
import { captureReleaseInputs } from './release-evidence.mjs';
import { localSettings } from './local-settings.mjs';

export class PreparationBlocked extends Error {}

export async function settings(local) {
  const defaults = JSON.parse(await fs.readFile(new URL('../config.json', import.meta.url), 'utf8'));
  const overrides = await localSettings(local);
  const value = { ...defaults, ...overrides };
  if (value.schema !== 1 || typeof value.allowDependencyInstall !== 'boolean') throw new Error('Build configuration requires schema 1 and boolean allowDependencyInstall.');
  return value;
}

export async function executeTarget(root, local, target, signal, stage, { prepare = false, prepareOnly = false, automatic = false, resultFile } = {}) {
  if (resultFile && (path.dirname(path.resolve(resultFile)) !== path.join(path.dirname(local), 'temp', 'invocations')
      || !/^[a-f0-9]{32}\.json$/.test(path.basename(resultFile)))) throw new Error('Invalid invocation result path.');
  const adapter = adapterFor(target);
  return withBuildOwnership(root, path.join(root, '.project-config/managed/web-app-launch/cache'), signal, stage, async () => {
    const config = await settings(local);
    stage('Checking environment', 'Validating Node/npm and exact project dependencies.', prepareOnly ? undefined : 'prepare');
    let environment = await adapter.inspect(root, signal);
    if (environment.enabled === false) throw new Error(environment.hints.join('\n'));
    if (environment.verificationStatus === 'unavailable') {
      throw new Error('Implemented target; native verification unavailable. ' + environment.hints.join('; '));
    }
    if (!environment.ready) {
      if (automatic) {
        const blocker = preparationBlock(target, environment, config.allowDependencyInstall);
        if (blocker) throw new PreparationBlocked(blocker.reason.replaceAll('\n', ' '));
      }
      if (!prepare && !prepareOnly) throw new Error('Environment Preparation Required: ' + environment.hints.join('\n') + '\nChoose Prepare Environment.');
      environment = await adapter.prepare(root, environment, signal, stage, config.allowDependencyInstall);
    }
    signal.throwIfAborted();
    if (automatic && !environment.ready) throw new Error(environment.hints.join('\n'));
    if (prepareOnly) return { verificationStatus: 'environment-ready' };
    const attempt = await beginResult(local);
    try {
      const before = await captureReleaseInputs(root, target);
      const verified = await adapter.build({ root, output: attempt.output, environment, signal, stage, config });
      signal.throwIfAborted();
      if (verified.verificationStatus !== 'verified' || !/^[a-f0-9]{64}$/.test(verified.integrity)
          || !/^[a-f0-9]{64}$/.test(verified.inputs)) throw new Error('Adapter did not return verified product evidence.');
      const after = await captureReleaseInputs(root, target);
      if (process.env.BUILDWEAVE_ACTIVITY === '1') {
        stage('Publishing native output', 'Retaining verified products and release evidence.', 'publish');
      }
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
