import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { withBuildOwnership, buildEnvironment } from './ownership.mjs';
import { foundation, ASTRO, VITE } from './foundation.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

export async function treeHash(root, exclude = () => false, ancestors = new Set()) {
  const hash = createHash('sha256');
  async function visit(folder, relative, parents) {
    const real = await fs.realpath(folder);
    if (parents.has(real)) throw new Error('Cyclic filesystem input: ' + folder);
    const next = new Set([...parents, real]);
    for (const name of (await fs.readdir(folder)).sort()) {
      const key = relative ? relative + '/' + name : name;
      if (exclude(key)) continue;
      const file = path.join(folder, name);
      const stat = await fs.stat(file);
      if (stat.isDirectory()) await visit(file, key, next);
      else if (stat.isFile()) {
        const content = await fs.readFile(file);
        hash.update(JSON.stringify([key, content.length]));
        hash.update(content);
      }
      else throw new Error('Unsupported build input: ' + file);
    }
  }
  await visit(root, '', ancestors);
  return hash.digest('hex');
}

export async function npmEntry() {
  const directories = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)];
  for (const directory of directories) {
    for (const candidate of [path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
                             path.join(directory, 'npm'), path.join(directory, 'npm.cmd')]) {
      try {
        const real = await fs.realpath(candidate);
        if (real.endsWith('npm-cli.js')) return real;
        if (candidate.endsWith('npm.cmd')) {
          const adjacent = path.join(directory, 'node_modules/npm/bin/npm-cli.js');
          await fs.access(adjacent);
          return adjacent;
        }
      } catch { /* Continue through the current host PATH. */ }
    }
  }
  throw new Error('npm was not found beside Node or on PATH. Install Node.js with npm and retry.');
}

export function npm(npmPath, args, root, signal, quiet = false) {
  signal.throwIfAborted();
  const env = buildEnvironment(root);
  const outputIndex = args.indexOf('--outDir');
  const outputEnvironment = env.RUNNER_WEB_APP_BUILD_LEASE && outputIndex >= 0 && args[outputIndex + 1]
    ? { ...env, RUNNER_WEB_APP_BUILD_OUTPUT: path.resolve(root, args[outputIndex + 1]) } : env;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmPath, ...args], {
      cwd: root, stdio: quiet ? 'ignore' : ['ignore', 'inherit', 'inherit'],
      env: outputEnvironment,
      detached: process.platform !== 'win32', windowsHide: true,
    });
    const cancel = () => {
      if (child.exitCode !== null || !child.pid) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
                  { stdio: 'ignore', windowsHide: true });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
          if (error.code !== 'ESRCH') reject(error);
        }
      }
    };
    signal.addEventListener('abort', cancel, { once: true });
    child.once('error', reject);
    child.once('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else resolve(code);
    });
  });
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function platformMatches(values, actual) {
  if (!values) return true;
  if (values.includes('!' + actual)) return false;
  const included = values.filter(value => !value.startsWith('!'));
  return included.length === 0 || included.includes(actual);
}

async function optionalDependencyNeeded(root, packages, name) {
  if (!packages) return true;
  const dependency = name.slice(name.lastIndexOf('node_modules/') + 'node_modules/'.length);
  for (const [parent, entry] of Object.entries(packages)) {
    if (!entry.dependencies?.[dependency] && !entry.optionalDependencies?.[dependency]
        && !(parent === '' && entry.devDependencies?.[dependency])) continue;
    let directory = parent;
    while (true) {
      const candidate = path.posix.join(directory, 'node_modules', dependency);
      if (packages[candidate]) {
        if (candidate === name && await fs.access(path.join(root, parent, 'package.json')).then(() => true, () => false)) return true;
        break;
      }
      if (!directory) break;
      const next = path.posix.dirname(directory);
      directory = next === '.' ? '' : next;
    }
  }
  return false;
}

export async function lockMatches(root, packageJson) {
  let lock;
  try { lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  const hostLibc = process.platform === 'linux'
    ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined;
  const entries = lock.packages
    ? Object.entries(lock.packages).filter(([name]) => name.startsWith('node_modules/'))
    : Object.entries(lock.dependencies || {}).map(([name, value]) => ['node_modules/' + name, value]);
  if (lock.packages) {
    const declared = lock.packages[''];
    if (!declared) return false;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const ordered = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
      if (ordered(declared[section]) !== ordered(packageJson[section])) return false;
    }
  }
  for (const [name, expected] of entries) {
    if (!platformMatches(expected.os, process.platform) || !platformMatches(expected.cpu, process.arch)
        || (hostLibc && !platformMatches(expected.libc, hostLibc))) continue;
    const folder = path.resolve(root, name);
    if (!contained(root, folder)) throw new Error('Lockfile dependency path escapes this checkout.');
    let installed;
    try { installed = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8')); } catch (error) {
      // Foreign optional binary subtrees can leave platform-neutral lock entries.
      if (error.code === 'ENOENT' && expected.optional && !await optionalDependencyNeeded(root, lock.packages, name)) continue;
      return false;
    }
    if (!expected.link && expected.version && installed.version !== expected.version) return false;
  }
  return true;
}

export async function configuration(root, choice) {
  choice ||= await foundation(root, { requireApplied: true });
  if (choice === ASTRO) return (await import('./astro.mjs')).configuration(root);
  const vitePath = createRequire(path.join(root, 'package.json')).resolve('vite');
  const localVite = path.join(root, 'node_modules', 'vite');
  const viteRoot = await fs.realpath(localVite);
  if (!vitePath.startsWith(viteRoot + path.sep)) {
    throw new Error('Vite must resolve from this checkout\'s installed dependencies.');
  }
  const { resolveConfig } = await import(pathToFileURL(vitePath).href);
  const config = await resolveConfig({ root }, 'build', 'production', 'production');
  const sourceDirectories = [config.root, config.envDir, config.publicDir].filter(Boolean).map(value => path.resolve(value));
  const output = path.resolve(config.root, config.build.outDir);
  const outputOwner = path.relative(root, output).split(path.sep)[0];
  if (!contained(root, output) || ['node_modules', '.runner', '.git', 'src', 'public', 'tests'].includes(outputOwner)) {
    throw new Error('Vite build.outDir must be a dedicated directory inside this checkout.');
  }
  if (sourceDirectories.some(value => value === output || contained(output, value))) {
    throw new Error('Vite build.outDir cannot contain the application root, publicDir or envDir.');
  }
  const realOutput = await fs.realpath(output).catch(error => {
    if (error.code === 'ENOENT') return output;
    throw error;
  });
  let ancestor = path.dirname(output);
  while (ancestor !== root && !await fs.access(ancestor).then(() => true, () => false)) {
    ancestor = path.dirname(ancestor);
  }
  if (realOutput !== output || await fs.realpath(ancestor) !== ancestor) {
    throw new Error('Vite build.outDir must use a plain checkout directory without filesystem indirection.');
  }
  for (const candidate of [config.root, config.envDir, config.publicDir].filter(Boolean)) {
    if (path.resolve(candidate) !== root && !contained(root, path.resolve(candidate))) {
      throw new Error('Vite root, envDir and publicDir must be inside this checkout.');
    }
  }
  if (!config.build.write || config.build.lib || config.build.ssr || config.build.watch) {
    throw new Error('This launcher requires a finite Vite browser build with HTML output.');
  }
  const testResults = path.join(root, 'test-results');
  const excludeTestResults = !sourceDirectories.some(value => value === testResults || contained(testResults, value));
  return { output, base: config.base.startsWith('/') ? config.base : '/', excludeTestResults };
}

export async function inputs(root, output, excludeTestResults, choice = VITE) {
  const excludedOutput = path.relative(root, output).split(path.sep).join('/');
  const source = await treeHash(root, key => {
    const first = key.split('/')[0];
    // Keep explicitly configured application/public/env inputs even in the usual test output directory.
    return ['.git', 'node_modules'].includes(first) || (choice === ASTRO && first === '.astro')
      || (first === 'test-results' && excludeTestResults)
      || key === excludedOutput || key.startsWith(excludedOutput + '/')
      || key === '.runner/web-app-launch/cache' || key.startsWith('.runner/web-app-launch/cache/')
      || key === '.runner/web-app-tauri/cache' || key.startsWith('.runner/web-app-tauri/cache/')
      || key === '.runner/web-app-electron/cache' || key.startsWith('.runner/web-app-electron/cache/')
      || key === '.runner/web-app-electron/node_modules' || key.startsWith('.runner/web-app-electron/node_modules/')
      || key === '.runner/web-app-launch/settings.json'
      || key === 'src-tauri/target' || key.startsWith('src-tauri/target/')
      || key === 'src-tauri/gen' || key.startsWith('src-tauri/gen/')
      || key === 'tools/web_app_build_system' || key.startsWith('tools/web_app_build_system/')
      || ['build.cmd', 'build.sh', 'build.command'].includes(key);
  });
  const dependencies = await treeHash(path.join(root, 'node_modules'), key =>
    ['.vite', '.vite-temp', '.cache', '.vite-web-app-testing', ...(choice === ASTRO ? ['.astro'] : [])].includes(key.split('/')[0]));
  const git = spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'],
                       { encoding: 'utf8', windowsHide: true });
  return digest(JSON.stringify({
    schema: 1, root, source, dependencies, node: process.version, platform: process.platform,
    environment: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)),
    head: git.status === 0 ? git.stdout.trim() : null,
  }));
}

export async function verifiedOutput(output, choice = VITE) {
  const html = await fs.readFile(path.join(output, 'index.html'));
  if (!html.length) throw new Error('The build did not produce a nonempty index.html.');
  if (choice === ASTRO && !['html', 'head', 'body'].every(tag => new RegExp('<' + tag + '(?:\\s|>)', 'i').test(html.toString('utf8')))) {
    throw new Error('Astro static output must contain a complete HTML document; JavaScript assets are optional.');
  }
  return treeHash(output);
}

export async function currentBuild(root, cache, signal, stage) {
  return withBuildOwnership(root, cache, signal, stage, async () => {
  let snapshot;
  try {
    stage('Checking dependencies', 'Check Node/npm, dependency declarations and lockfile, then retry.');
    const cli = await npmEntry();
    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const choice = await foundation(root, { requireApplied: true });
    const semver = createRequire(cli)('semver');
    const nodeRange = choice === ASTRO ? '>=22.12.0' : '^20.19.0 || >=22.12.0';
    if (!semver.satisfies(process.version, nodeRange) || choice === ASTRO && Number(process.versions.node.split('.')[0]) % 2
        || (packageJson.engines?.node && !semver.satisfies(process.version, packageJson.engines.node))) {
      throw new Error('The current Node version does not satisfy this project. Install a compatible Node.js version.');
    }
    if (choice === ASTRO) {
      const installedNpm = JSON.parse(await fs.readFile(path.resolve(path.dirname(cli), '../package.json'), 'utf8'));
      if (!semver.satisfies(installedNpm.version, '>=9.6.5')) throw new Error('Astro requires npm 9.6.5+. Install compatible npm and retry.');
    }
    if (!packageJson.scripts?.build) throw new Error('package.json must define the canonical build script.');
    if (await npm(cli, ['ls', '--all', '--include=dev'], root, signal, true) !== 0
        || !await lockMatches(root, packageJson)) {
      stage('Installing dependencies', 'Check dependency declarations, lockfile and registry access, then retry.');
      const locked = await fs.access(path.join(root, 'package-lock.json')).then(() => true, () => false);
      if (await npm(cli, [locked ? 'ci' : 'install', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], root, signal) !== 0) {
        throw new Error('npm dependency installation failed.');
      }
      if (await npm(cli, ['ls', '--all', '--include=dev'], root, signal, true) !== 0
          || !await lockMatches(root, packageJson)) {
        throw new Error('Installed dependencies are missing or incompatible with the project declarations.');
      }
    }
    stage('Checking build inputs', 'Check the selected Foundation configuration and readable project inputs, then retry.');
    const { output, base, excludeTestResults } = await configuration(root, choice);
    const before = await inputs(root, output, excludeTestResults, choice);
    const records = path.join(cache, 'builds');
    await fs.mkdir(records, { recursive: true });
    const recordPath = path.join(records, before + '.json');
    let record;
    try { record = JSON.parse(await fs.readFile(recordPath, 'utf8')); } catch { /* No verified cache. */ }
    let outputHash;
    try { outputHash = await verifiedOutput(output, choice); } catch { /* Missing or invalid output. */ }
    const reuse = record?.schema === 1 && record.root === root && record.inputs === before
      && record.output === output && record.integrity === outputHash && Boolean(outputHash);
    if (!reuse) {
      await fs.rm(recordPath, { force: true });
      stage('Building application', 'Fix the npm/TypeScript/Foundation error shown above, then reopen the launcher.');
      // A successful command must emit HTML again; never accept an old entry point.
      await fs.rm(path.join(output, 'index.html'), { force: true });
      if (await npm(cli, ['run', 'build'], root, signal) !== 0) throw new Error('npm run build failed.');
      stage('Verifying build', 'Check build outputs and avoid editing inputs during compilation, then retry.');
      outputHash = await verifiedOutput(output, choice);
      if (await inputs(root, output, excludeTestResults, choice) !== before) throw new Error('Build inputs changed during compilation. Retry with stable inputs.');
    }
    signal.throwIfAborted();
    snapshot = path.join(cache, 'previews', randomUUID());
    await fs.mkdir(snapshot, { recursive: true });
    await fs.cp(output, path.join(snapshot, 'app'), { recursive: true, dereference: true });
    if (await verifiedOutput(path.join(snapshot, 'app'), choice) !== outputHash || await inputs(root, output, excludeTestResults, choice) !== before) {
      await fs.rm(recordPath, { force: true });
      throw new Error('Inputs or output changed while the preview snapshot was being verified. Retry.');
    }
    if (!reuse) {
      const staging = recordPath + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(staging, JSON.stringify({ schema: 1, root, inputs: before, output,
                                                   integrity: outputHash }) + '\n', { flag: 'wx' });
        await fs.rename(staging, recordPath);
      } finally { await fs.rm(staging, { force: true }); }
    }
    console.log('[Web App] ' + (reuse ? 'Reusing verified current build.' : 'Current build verified.'));
    return { snapshot, base, foundation: choice };
  } catch (error) {
    if (snapshot) await fs.rm(snapshot, { recursive: true, force: true });
    throw error;
  }
  });
}
