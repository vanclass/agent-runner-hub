import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectEnvironment, prepareEnvironment } from '../environment.mjs';
import { npm } from '../project.mjs';
import { executable, command } from './process.mjs';
import { runtimeSelection } from './selection.mjs';
import { inspectNsis, prepareNsis } from './nsis.mjs';
import { macosTools } from './macos-environment.mjs';

export const targetTriple = process.platform === 'darwin'
  ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
  : 'x86_64-pc-windows-msvc';
const exists = file => fs.stat(file).then(s => s.isFile(), () => false);

function versionAtLeast(value, minimum) {
  if (!/^\d+\.\d+\.\d+$/.test(value || '') || !/^\d+\.\d+\.\d+$/.test(minimum || '')) return false;
  const actual = value.split('.').map(Number), required = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

export async function windowsTools(root, signal, { inspectWebview = true } = {}) {
  const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles;
  if (!programFiles) return { cpp: false, sdk: false, webview: false };
  const vswhere = path.join(programFiles, 'Microsoft Visual Studio/Installer/vswhere.exe');
  let cpp = false, sdk = false, webview = false, sdkVersion, webviewVersion, msvcVersion;
  let developerEnvironment = {};
  if (await exists(vswhere)) {
    const result = await command(vswhere, ['-latest', '-products', '*', '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], root, signal);
    if (result.code === 0 && result.output) {
      const tools = path.join(result.output, 'VC/Tools/MSVC');
      for (const version of (await fs.readdir(tools).catch(() => [])).sort().reverse()) {
        const bin = path.join(tools, version, 'bin/Hostx64/x64');
        if (await exists(path.join(bin, 'cl.exe')) && await exists(path.join(bin, 'link.exe'))) {
          const developer = path.join(result.output, 'Common7/Tools/VsDevCmd.bat');
          if (/["%!^\r\n]/.test(developer)) break;
          const shell = path.join(process.env.SystemRoot, 'System32/cmd.exe');
          const invocation = '""' + developer + '" -no_logo -arch=x64 -host_arch=x64 >nul'
            + ' && set PATH && set INCLUDE && set LIB && set WindowsSdkDir && set WindowsSDKVersion"';
          const initialized = await command(shell, ['/u', '/d', '/s', '/c', invocation], root, signal,
            { windowsVerbatimArguments: true, outputEncoding: 'utf16le' });
          const allowed = new Map(['PATH', 'INCLUDE', 'LIB', 'LIBPATH', 'WindowsSdkDir', 'WindowsSDKVersion']
            .map(key => [key.toLowerCase(), key]));
          for (const line of initialized.output.split(/\r?\n/)) {
            const index = line.indexOf('=');
            const key = allowed.get(line.slice(0, index).toLowerCase());
            if (key) developerEnvironment[key] = line.slice(index + 1);
          }
          cpp = initialized.code === 0 && Boolean(developerEnvironment.INCLUDE && developerEnvironment.LIB);
          msvcVersion = version; break;
        }
      }
    }
  }
  const kits = developerEnvironment.WindowsSdkDir || path.join(programFiles, 'Windows Kits/10');
  const selectedSdk = developerEnvironment.WindowsSDKVersion?.replace(/[\\/]+$/, '');
  for (const version of selectedSdk ? [selectedSdk] : (await fs.readdir(path.join(kits, 'Include')).catch(() => [])).sort().reverse()) {
    if (await exists(path.join(kits, 'Include', version, 'um/Windows.h'))
        && await exists(path.join(kits, 'Include', version, 'ucrt/stdio.h'))
        && await exists(path.join(kits, 'Lib', version, 'um/x64/kernel32.lib'))
        && await exists(path.join(kits, 'Lib', version, 'ucrt/x64/ucrt.lib'))
        && await exists(path.join(kits, 'bin', version, 'x64/rc.exe'))) {
      sdk = true; sdkVersion = version; break;
    }
  }
  const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = "$ErrorActionPreference='Stop'; $roots=@('HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients','HKLM:\\Software\\Microsoft\\EdgeUpdate\\Clients','HKLM:\\Software\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients'); foreach($root in $roots){ if(Test-Path -LiteralPath $root){ Get-ChildItem -LiteralPath $root | ForEach-Object { $v=Get-ItemProperty -LiteralPath $_.PSPath; if($v.name -match 'WebView2' -and $v.pv -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' -and $v.pv -ne '0.0.0.0'){ $v.pv } } } }";
  const versions = inspectWebview
    ? await command(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], root, signal)
    : { code: 1 };
  if (versions.code === 0 && versions.output) {
    webviewVersion = versions.output.split(/\r?\n/).find(value => /^\d+\.\d+\.\d+\.\d+$/.test(value));
    webview = Boolean(webviewVersion);
  }
  return { cpp, sdk, webview, msvcVersion, sdkVersion, webviewVersion, developerEnvironment };
}

export async function inspectNative(root, signal, { buildSystem = false, expectedPlatform } = {}) {
  const selection = await runtimeSelection(root, buildSystem);
  if (!selection.enabled) return { ...selection, ready: false, preparable: false };
  const macos = process.platform === 'darwin';
  if (!(macos && ['arm64', 'x64'].includes(process.arch) || process.platform === 'win32' && process.arch === 'x64')
      || expectedPlatform && expectedPlatform !== process.platform) return {
    enabled: true, ready: false, preparable: false, verificationStatus: 'unavailable',
    hints: [expectedPlatform === 'darwin' ? 'macOS arm64/Intel host required for app/dmg packaging.'
      : expectedPlatform === 'win32' ? 'Windows x64 host required for MSVC/NSIS packaging.'
      : 'Native desktop development requires Windows x64 or macOS arm64/Intel.'] };
  const web = await inspectEnvironment(root, signal);
  const hints = [...web.hints], requirements = [];
  const requireTool = (id, condition, message, action) => {
    if (!condition) { hints.push(message); requirements.push({ id, action, message }); }
  };
  const folder = path.join(root, '.runner/web-app-tauri');
  let recipe;
  try { recipe = JSON.parse(await fs.readFile(path.join(folder, 'cli-package.json'), 'utf8')); }
  catch (error) { return { enabled: true, ready: false, preparable: false, hints: ['Apply current Tauri resources: ' + error.message] }; }
  const rustup = await executable('rustup');
  const rustc = await executable('rustc');
  const cargo = await executable('cargo');
  let rustToolchain;
  let rustArguments = [];
  const tools = macos ? await macosTools(root, signal) : await windowsTools(root, signal);
  if (macos) {
    requireTool('xcode-clt', tools.ready, 'Install Xcode Command Line Tools with xcode-select --install, finish the Apple installer/license prompts, then retry Prepare.', 'external');
  } else {
  requireTool('msvc', tools.cpp, 'Install Microsoft C++ Build Tools with Desktop development with C++ (x64/x86 MSVC). Administrator/installer consent may be required; do not elevate from this menu.', 'external');
  requireTool('sdk', tools.sdk, 'Install Windows 10/11 SDK with x64 headers, libraries and resource compiler in Visual Studio Installer. Finish any requested restart, then retry Prepare.', 'external');
  requireTool('webview2', tools.webview, 'Install Microsoft Edge WebView2 Evergreen Runtime for this user or machine. Installer consent/privileges may be required; finish installation/restart and retry.', 'external');
  }
  requireTool('rust', rustc && cargo, 'Install Rust/Cargo (rustup) for ' + targetTriple + '; finish the installer, open a fresh terminal and retry Prepare. Compatible installations are reused.', 'external');
  let rustVersion, cargoVersion, host, targetReady = false;
  if (rustc && cargo) {
    let rust = await command(rustc, ['--version', '--verbose'], root, signal);
    let cargoResult = await command(cargo, ['--version'], root, signal);
    const defaultVersion = rust.output.match(/rustc (\d+\.\d+\.\d+)/)?.[1] || '0.0.0';
    const defaultCargo = cargoResult.output.match(/cargo (\d+\.\d+\.\d+)/)?.[1] || '0.0.0';
    if (rustup && (rust.code !== 0 || cargoResult.code !== 0
        || rust.output.match(/host: ([^\s]+)/)?.[1] !== targetTriple
        || !versionAtLeast(defaultVersion, recipe.runnerTauri.minimumRust)
        || !versionAtLeast(defaultCargo, recipe.runnerTauri.minimumRust))) {
      rustToolchain = 'stable-' + targetTriple;
      rustArguments = ['+' + rustToolchain];
      rust = await command(rustc, [...rustArguments, '--version', '--verbose'], root, signal);
      cargoResult = await command(cargo, [...rustArguments, '--version'], root, signal);
    }
    if (rustup && !rustToolchain) {
      const active = await command(rustup, ['show', 'active-toolchain'], root, signal);
      rustToolchain = active.code === 0 ? active.stdout.match(/^(\S+)/)?.[1] : undefined;
      if (!rustToolchain) throw new Error('Cannot identify the verified active Rust toolchain. Resolve rustup state and retry Prepare.');
      rustArguments = ['+' + rustToolchain];
    }
    rustVersion = rust.output.match(/rustc (\d+\.\d+\.\d+)/)?.[1];
    host = rust.output.match(/host: ([^\s]+)/)?.[1];
    cargoVersion = cargoResult.output.match(/cargo (\d+\.\d+\.\d+)/)?.[1];
    requireTool('rust-version', rust.code === 0 && cargoResult.code === 0
      && versionAtLeast(rustVersion, recipe.runnerTauri.minimumRust)
      && versionAtLeast(cargoVersion, recipe.runnerTauri.minimumRust),
      'Rust/Cargo must start and Rust must be >= ' + recipe.runnerTauri.minimumRust + '. Prepare ' + targetTriple + ', then retry.', rustup ? 'rustup-toolchain' : 'external');
    requireTool('rust-host', host === targetTriple,
      'Prepare Rust host ' + targetTriple + '; selected only for the child process.', rustup ? 'rustup-toolchain' : 'external');
    const library = await command(rustc, [...rustArguments, '--print', 'target-libdir', '--target', targetTriple], root, signal);
    targetReady = library.code === 0 && (await fs.readdir(library.output).catch(() => []))
      .some(name => /^libstd.*\.rlib$/.test(name));
    requireTool('rust-target', targetReady, 'Install the Rust standard library target: rustup target add ' + targetTriple + '.', rustup ? 'rustup-target' : 'external');
  }
  const cliRoot = path.join(folder, 'cache/cli');
  let cli;
  try {
    if (await fs.realpath(cliRoot) !== cliRoot) throw new Error('Tauri CLI must use the plain runtime-owned cache.');
    const localRecipe = JSON.parse(await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8'));
    const installed = JSON.parse(await fs.readFile(path.join(cliRoot, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'));
    const semver = web.cli ? createRequire(web.cli)('semver') : null;
    if (JSON.stringify(localRecipe) === JSON.stringify(recipe) && semver
        && semver.satisfies(installed.version, recipe.devDependencies['@tauri-apps/cli'])) {
      cli = path.join(cliRoot, 'node_modules/@tauri-apps/cli/tauri.js');
      const [check, build, dev] = await Promise.all([
        command(process.execPath, [cli, '--version'], root, signal),
        command(process.execPath, [cli, 'build', '--help'], root, signal),
        command(process.execPath, [cli, 'dev', '--help'], root, signal),
      ]);
      if (check.code !== 0 || check.stdout.trim() !== 'tauri-cli ' + installed.version
          || build.code !== 0 || dev.code !== 0 || !build.stdout.includes('--bundles')
          || !build.stdout.includes('--no-sign') || !dev.stdout.includes('--no-watch')) cli = undefined;
    }
  } catch { signal.throwIfAborted(); }
  requireTool('tauri-cli', cli, 'Prepare the project-local Tauri 2 CLI dependencies. Application package settings and lockfiles are preserved.', 'npm-cli');
  const nsis = buildSystem && !macos ? await inspectNsis(root, signal) : undefined;
  if (nsis) requireTool('nsis', nsis.ready, nsis.hint || 'Prepare verified NSIS tools.', 'nsis');
  return { enabled: true, ready: web.ready && requirements.length === 0,
    preparable: Boolean((!web.ready && web.preparable) || requirements.some(r => r.action !== 'external')),
    hints, requirements, web, recipe, cliRoot, cli, rustup, rustc, cargo, rustToolchain, nsis, packaging: buildSystem,
    platform: process.platform, targetTriple, expectedPlatform,
    developerEnvironment: tools.developerEnvironment,
    versions: { rust: rustVersion, cargo: cargoVersion, host, msvc: tools.msvcVersion,
      sdk: tools.sdkVersion, webview2: tools.webviewVersion, xcode: tools.xcodeVersion,
      macosSdk: tools.macosSdk, tauriCli: recipe.devDependencies['@tauri-apps/cli'] } };
}

export async function prepareFrontend(root, environment, signal, stage, allowed) {
  const snapshot = new Map();
  for (const name of ['package.json', 'package-lock.json']) {
    const file = path.join(root, name);
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Native preparation requires plain project dependency files: ' + name);
    snapshot.set(file, stat ? await fs.readFile(file) : null);
  }
  try { await prepareEnvironment(root, environment, signal, stage, allowed); }
  catch (cause) {
    for (const [file, before] of snapshot) {
      const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Restore dependency files before retrying native preparation; unexpected indirection: ' + file, { cause });
      const after = stat ? await fs.readFile(file) : null;
      if (before === null ? after === null : after !== null && before.equals(after)) continue;
      if (before === null) await fs.unlink(file); else await fs.writeFile(file, before);
      if (before && !before.equals(await fs.readFile(file))) throw new Error('Dependency restoration failed; restore original declarations/lock before retrying.', { cause });
    }
    throw cause;
  }
}

export async function prepareNative(root, environment, signal, stage, allowed) {
  if (environment.ready) return environment;
  if (!allowed) throw new Error('Installation is disabled by allowDependencyInstall. Prepare the listed tools yourself or enable permitted dependency installation in local settings.');
  const blockers = (environment.requirements || []).filter(r => r.action === 'external');
  if (blockers.length) throw new Error('External installation/user action required:\n' + blockers.map(r => r.message).join('\n'));
  if (!environment.enabled || environment.verificationStatus === 'unavailable') throw new Error(environment.hints.join('\n'));
  if (!environment.web.ready) {
    await prepareFrontend(root, environment.web, signal, stage, allowed);
  }
  const prepared = new Set();
  for (const requirement of environment.requirements || []) {
    if (prepared.has(requirement.action)) continue;
    prepared.add(requirement.action);
    if (requirement.action === 'rustup-toolchain') {
      stage('Preparing Rust', 'Updating the existing user-owned Rust toolchain; registry/network access is required. Ctrl+C cancels.');
      if ((await command(environment.rustup, ['toolchain', 'install', environment.rustToolchain, '--profile', 'minimal'], root, signal, { quiet: false })).code !== 0) {
        throw new Error('Rust update failed. Resolve access/permissions or restart requirements, then retry Prepare.');
      }
    } else if (requirement.action === 'rustup-target') {
      stage('Preparing Rust target', 'Installing ' + targetTriple + '; Ctrl+C cancels.');
      if ((await command(environment.rustup, ['target', 'add', targetTriple,
        ...(environment.rustToolchain ? ['--toolchain', environment.rustToolchain] : [])], root, signal, { quiet: false })).code !== 0) {
        throw new Error('Rust target preparation failed. Check rustup output and retry.');
      }
    } else if (requirement.action === 'npm-cli') {
      stage('Preparing Tauri CLI', 'Installing declared Tauri 2 CLI in the runtime-owned cache; project lockfiles stay intact. Ctrl+C cancels.');
      await fs.mkdir(environment.cliRoot, { recursive: true });
      if (await fs.realpath(environment.cliRoot) !== environment.cliRoot) throw new Error('Tauri dependency cache must be a plain checkout directory.');
      await fs.writeFile(path.join(environment.cliRoot, 'package.json'), JSON.stringify(environment.recipe, null, 2) + '\n');
      if (await npm(environment.web.cli, ['install', '--include=dev', '--include=optional', '--no-audit', '--no-fund'],
        environment.cliRoot, signal) !== 0) throw new Error('Tauri CLI installation failed; check network/permissions and retry Prepare.');
    } else if (requirement.action === 'nsis') {
      await prepareNsis(root, signal, stage, allowed);
    }
  }
  const current = await inspectNative(root, signal, { buildSystem: environment.packaging, expectedPlatform: environment.expectedPlatform });
  if (!current.ready) throw new Error('Preparation is incomplete: ' + current.hints.join('\n'));
  stage('Tauri desktop environment ready', 'Reverified ' + targetTriple + '; continuing the selected action.');
  return current;
}
