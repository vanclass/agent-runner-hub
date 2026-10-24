import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runtimeEnabled } from '../runtime-selection.mjs';
import { npm, lockMatches } from '../project.mjs';
import { command } from '../native/process.mjs';

async function runtimeOwner(root) {
  return import(pathToFileURL(path.join(root, '.runner/web-app-electron/environment.mjs')));
}

async function forgeTools(folder, recipe, cli, signal, reportFailure = false) {
  try {
    if (await fs.realpath(folder) !== folder) return null;
    const semver = createRequire(cli)('semver');
    const local = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    if (JSON.stringify(local) !== JSON.stringify(recipe) || !await lockMatches(folder, recipe)) return null;
    for (const [name, range] of Object.entries(recipe.devDependencies)) {
      const installed = JSON.parse(await fs.readFile(path.join(folder, 'node_modules', name, 'package.json'), 'utf8'));
      if (!semver.satisfies(installed.version, range)) return null;
    }
    if (await npm(cli, ['ls', '--all', '--include=dev', '--include=optional'], folder, signal, true) !== 0) return null;
    const pkg = JSON.parse(await fs.readFile(path.join(folder, 'node_modules/@electron-forge/cli/package.json'), 'utf8'));
    const forge = path.join(folder, 'node_modules/@electron-forge/cli', pkg.bin['electron-forge']);
    const check = await command(process.execPath, [forge, '--version'], folder, signal);
    if (check.code !== 0 || !check.stdout.includes(pkg.version)) return null;
    const squirrel = path.join(folder, 'node_modules/electron-winstaller/vendor/Squirrel.exe');
    if (!(await fs.stat(squirrel)).size) return null;
    for (const name of ['7z.exe', '7z.dll', 'nuget.exe']) {
      if (!(await fs.stat(path.join(folder, 'node_modules/electron-winstaller/vendor', name))).size) return null;
    }
    return { forge, version: pkg.version, squirrel };
  } catch (error) { signal.throwIfAborted(); if (reportFailure) throw new Error('Forge prerequisite verification failed: ' + error.message + '. Check package script policy and vendor tool preparation; no global policy override is performed.'); return null; }
}

export async function inspectWindowsElectron(root, signal) {
  if (!await runtimeEnabled(root, 'Electron', true)) return { enabled: false, ready: false, preparable: false,
    hints: ['Select and Apply both Web App > Runtimes > Electron and Tools > Web App Build System.'] };
  if (process.platform !== 'win32' || process.arch !== 'x64') return { enabled: true, ready: false, preparable: false,
    verificationStatus: 'unavailable', hints: ['Windows x64 host required for Electron Forge / Squirrel.Windows packaging.'] };
  let owner, runtime;
  try { owner = await runtimeOwner(root); runtime = await owner.inspectElectron(root, signal, { buildSystem: true }); }
  catch (error) { return { enabled: true, ready: false, preparable: false, hints: ['Apply current Electron runtime files: ' + error.message] }; }
  const recipe = JSON.parse(await fs.readFile(new URL('../../electron-package.json', import.meta.url), 'utf8'));
  if (runtime.web?.cli && !createRequire(runtime.web.cli)('semver').satisfies(process.version, recipe.engines.node)) return {
    enabled: true, ready: false, preparable: false, hints: ['Electron Forge requires Node ' + recipe.engines.node + '; install compatible Node/npm externally and retry.'] };
  const tools = path.join(root, 'tools/web_app_build_system/.local/electron-tools');
  const forge = runtime.web?.cli ? await forgeTools(tools, recipe, runtime.web.cli, signal) : null;
  const hints = [...runtime.hints];
  if (!forge) hints.push('Prepare local Electron Forge, Squirrel.Windows maker and packaging binaries. Native modules may additionally require Python/MSVC/Windows SDK installed externally; no privilege elevation is performed.');
  return { enabled: true, ready: runtime.ready && Boolean(forge), preparable: runtime.ready || runtime.preparable,
    hints, runtime, tools, recipe, forge, versions: { ...runtime.versions, forge: forge?.version } };
}

export async function prepareWindowsElectron(root, environment, signal, stage, allowed) {
  if (environment.ready) return environment;
  if (!environment.enabled || !environment.preparable || environment.verificationStatus === 'unavailable') throw new Error(environment.hints.join('\n'));
  if (!allowed) throw new Error('Dependency installation is disabled. Enable allowDependencyInstall in .local/settings.json, or prepare tools yourself.');
  const owner = await runtimeOwner(root);
  if (!environment.runtime.ready) environment.runtime = await owner.prepareElectron(root, environment.runtime, signal, stage, allowed);
  if (!environment.forge) {
    stage('Preparing Windows / Electron packaging tools', 'Installing local Forge/Squirrel dependencies and vendor binaries. Registry/download access and write permission are required; Ctrl+C cancels.');
    const local = path.dirname(environment.tools);
    await fs.mkdir(local, { recursive: true });
    if (await fs.realpath(local) !== local) throw new Error('Packaging tools must use the plain checkout-local Build System directory.');
    const attempt = path.join(local, 'electron-install-' + randomUUID());
    const backup = path.join(local, 'electron-previous-' + randomUUID());
    await fs.mkdir(attempt);
    let moved = false, committed = false;
    try {
      await fs.writeFile(path.join(attempt, 'package.json'), JSON.stringify(environment.recipe, null, 2) + '\n');
      let lock;
      try {
        const prior = JSON.parse(await fs.readFile(path.join(environment.tools, 'package.json'), 'utf8'));
        if (JSON.stringify(prior) === JSON.stringify(environment.recipe)) lock = await fs.readFile(path.join(environment.tools, 'package-lock.json'));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (lock) await fs.writeFile(path.join(attempt, 'package-lock.json'), lock);
      if (await npm(environment.runtime.web.cli, [lock ? 'ci' : 'install', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], attempt, signal) !== 0) {
        throw new Error('Forge/Squirrel preparation failed. Check npm/download/proxy access, antivirus restrictions, local permissions and native-module compiler output; externally install Python/MSVC/SDK if required, then retry Prepare. No elevation or source/lockfile replacement was attempted.');
      }
      if (lock && !lock.equals(await fs.readFile(path.join(attempt, 'package-lock.json')))) throw new Error('Forge preparation changed an existing tool lockfile.');
      if (!await forgeTools(attempt, environment.recipe, environment.runtime.web.cli, signal, true)) throw new Error('Forge/Squirrel dependencies or vendor binaries failed readiness verification.');
      signal.throwIfAborted();
      try { await fs.rename(environment.tools, backup); moved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(attempt, environment.tools); committed = true;
    } finally {
      if (!committed && moved) await fs.rename(backup, environment.tools);
      await fs.rm(attempt, { recursive: true, force: true });
      if (committed && moved) await fs.rm(backup, { recursive: true, force: true });
    }
  }
  const current = await inspectWindowsElectron(root, signal);
  if (!current.ready) throw new Error('Windows/Electron preparation incomplete: ' + current.hints.join('\n'));
  return current;
}
