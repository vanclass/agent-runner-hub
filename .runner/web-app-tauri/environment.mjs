import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { npmEntry, npm, lockMatches } from './project.mjs';
import { foundation, ASTRO } from './foundation.mjs';

export async function inspectEnvironment(root, signal) {
  const hints = [];
  let cli, packageJson, semver, choice;
  try {
    cli = await npmEntry();
    semver = createRequire(cli)('semver');
    const version = await npm(cli, ['--version'], root, signal, true);
    if (version !== 0) throw new Error('npm could not start. Repair the Node/npm installation.');
  } catch (error) {
    signal.throwIfAborted();
    return { ready: false, preparable: false, hints: [error.message] };
  }
  try { packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (error) { return { ready: false, preparable: false, hints: ['Restore a valid project package.json: ' + error.message] }; }
  try { choice = await foundation(root, { requireApplied: true }); }
  catch (error) { return { ready: false, preparable: false, hints: [error.message] }; }
  const astro = choice === ASTRO;
  if (astro && (!semver.satisfies(process.version, '>=22.12.0') || Number(process.versions.node.split('.')[0]) % 2
      || !semver.satisfies(JSON.parse(await fs.readFile(path.resolve(path.dirname(cli), '../package.json'), 'utf8')).version, '>=9.6.5'))) {
    return { ready: false, preparable: false, hints: ['Astro 6 requires even Node >=22.12.0 and npm >=9.6.5. Install compatible Node/npm.'] };
  }
  if (!semver.satisfies(process.version, '^20.19.0 || >=22.12.0')
      || (packageJson.engines?.node && !semver.satisfies(process.version, packageJson.engines.node))) {
    hints.push('Install compatible Node.js with npm; required: ' + (packageJson.engines?.node || '^20.19.0 || >=22.12.0')
      + '; current: ' + process.version + '. External installation/user privileges may be required.');
    return { ready: false, preparable: false, hints };
  }
  if (astro ? packageJson.scripts?.build !== 'astro check && astro build'
      : !packageJson.scripts?.build || !/\bvite\s+build\b/.test(packageJson.scripts.build)) {
    return { ready: false, preparable: false, hints: [astro
      ? 'Restore the canonical Astro build script: astro check && astro build.'
      : 'Define npm run build with a browser Vite build that accepts --outDir. Preserve your package declarations.'] };
  }
  if (packageJson.engines?.npm) {
    const { spawnSync } = await import('node:child_process');
    const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', windowsHide: true });
    if (version.status !== 0 || !semver.satisfies(version.stdout.trim(), packageJson.engines.npm)) {
      return { ready: false, preparable: false, hints: ['Install npm satisfying ' + packageJson.engines.npm + '. External user action is required.'] };
    }
  }
  let exact = false;
  try {
    exact = await npm(cli, ['ls', '--all', '--include=dev', '--include=optional'], root, signal, true) === 0
      && await lockMatches(root, packageJson);
    const require = createRequire(path.join(root, 'package.json'));
    for (const name of [astro ? 'astro' : 'vite', 'typescript']) {
      const resolved = require.resolve(name + '/package.json');
      const local = await fs.realpath(path.join(root, 'node_modules', name));
      if (!resolved.startsWith(local + path.sep)) exact = false;
      const installed = JSON.parse(await fs.readFile(resolved, 'utf8'));
      if (installed.engines?.node && !semver.satisfies(process.version, installed.engines.node)) {
        return { ready: false, preparable: false, hints: [name + ' requires Node ' + installed.engines.node + '; install a compatible Node version.'] };
      }
    }
  } catch { signal.throwIfAborted(); }
  if (!exact) hints.push('Missing or incompatible project dependencies. Prepare Environment installs the declared npm dependencies, including development/optional packages.');
  return { ready: exact, preparable: !exact, hints, cli, packageJson };
}

export async function prepareEnvironment(root, environment, signal, stage, allowed) {
  if (environment.ready) return environment;
  if (!environment.preparable) throw new Error(environment.hints.join('\n'));
  if (!allowed) throw new Error('Dependency installation is disabled. Enable allowDependencyInstall in .local/settings.json, or prepare npm dependencies yourself.');
  stage('Preparing environment', 'Installing declared npm dependencies; Ctrl+C cancels. Registry access and local write permission are required.');
  const locked = await fs.access(path.join(root, 'package-lock.json')).then(() => true, () => false);
  const manifest = await fs.readFile(path.join(root, 'package.json'));
  const lock = locked ? await fs.readFile(path.join(root, 'package-lock.json')) : null;
  if (await npm(environment.cli, [locked ? 'ci' : 'install', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], root, signal) !== 0) {
    throw new Error('Preparation failed. Check npm output, registry access, filesystem permissions and package/lock consistency; retry Prepare Environment.');
  }
  if (!manifest.equals(await fs.readFile(path.join(root, 'package.json')))
      || (lock && !lock.equals(await fs.readFile(path.join(root, 'package-lock.json'))))) {
    throw new Error('Preparation changed user dependency declarations or the existing lockfile. Review npm configuration before retrying.');
  }
  const current = await inspectEnvironment(root, signal);
  if (!current.ready) throw new Error('Preparation did not establish readiness: ' + current.hints.join('\n'));
  stage('Environment ready', 'Continuing the selected Web build.');
  return current;
}
