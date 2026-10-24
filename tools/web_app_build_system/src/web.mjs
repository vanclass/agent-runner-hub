import { configuration, inputs, npm } from './project.mjs';
import { inspectEnvironment, prepareEnvironment } from './environment.mjs';
import { verifyOutput } from './output.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { foundation, ASTRO } from './foundation.mjs';

export const webAdapter = {
  inspect: inspectEnvironment,
  prepare: prepareEnvironment,
  async build({ root, output, environment, signal, stage }) {
    const choice = await foundation(root, { requireApplied: true });
    const config = await configuration(root, choice);
    if (choice === ASTRO) return buildAstro({ root, output, environment, signal, stage, config, choice });
    const before = await inputs(root, config.output, config.excludeTestResults);
    stage('Building Web / Vite', 'Running npm run build in this checkout; Ctrl+C cancels.');
    const relativeOutput = output.slice(root.length + 1).split('\\').join('/');
    // Vite's final command receives a unique tool-owned outDir; existing dist stays intact.
    if (await npm(environment.cli, ['run', 'build', '--', '--outDir', relativeOutput, '--emptyOutDir'], root, signal) !== 0) {
      throw new Error('npm run build failed. Fix the TypeScript/Vite error and retry; earlier verified results are preserved.');
    }
    stage('Verifying Web output', 'Checking HTML, referenced assets, integrity and stable current-checkout inputs.');
    const integrity = await verifyOutput(output, config.base);
    if (await inputs(root, config.output, config.excludeTestResults) !== before) {
      throw new Error('Project inputs/dependencies changed during the build. Retry with stable source.');
    }
    return { integrity, inputs: before, verificationStatus: 'verified' };
  },
};

async function buildAstro({ root, output, environment, signal, stage, config, choice }) {
  const before = await inputs(root, config.output, config.excludeTestResults, choice);
  const backup = path.join(path.dirname(output), 'previous-output');
  let saved = false, owned = false;
  try {
    try { await fs.rename(config.output, backup); saved = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(config.output, { recursive: true });
    owned = true;
    stage('Building Web / Astro', 'Running canonical npm run build; Ctrl+C cancels.');
    if (await npm(environment.cli, ['run', 'build'], root, signal) !== 0) throw new Error('npm run build failed. Earlier verified results are preserved.');
    signal.throwIfAborted();
    stage('Verifying Astro static output', 'Checking complete HTML, local assets, integrity and stable inputs.');
    const integrity = await verifyOutput(config.output, config.base, choice);
    if (await inputs(root, config.output, config.excludeTestResults, choice) !== before) throw new Error('Project inputs/dependencies changed during the build. Retry with stable source.');
    await fs.rename(config.output, output);
    owned = false;
    if (await verifyOutput(output, config.base, choice) !== integrity) throw new Error('Astro publication changed during staging.');
    return { integrity, inputs: before, verificationStatus: 'verified', foundation: choice };
  } finally {
    if (owned) await fs.rm(config.output, { recursive: true, force: true });
    if (saved) await fs.rename(backup, config.output);
  }
}
