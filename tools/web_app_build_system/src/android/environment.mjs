import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { inspectEnvironment } from '../environment.mjs';
import { npm } from '../project.mjs';
import { runtimeSelection } from '../native/selection.mjs';
import { executable } from '../native/process.mjs';
import { probe as command } from './probe.mjs';
import { prepareFrontend, windowsTools } from '../native/environment.mjs';
import { inspectSdk, prepareSdk } from './sdk.mjs';
import { inspectVerifier, prepareVerifier } from './verifier.mjs';

export const androidTarget = 'aarch64-linux-android';
export const androidTargets = [androidTarget];
const exists = file => fs.stat(file).then(stat => stat.isFile(), () => false);

async function hostLink(root, rustc, host, env, signal) {
  const parent = path.join(root, 'tools/web_app_build_system/.local/probes');
  await fs.mkdir(parent, { recursive: true });
  if (await fs.realpath(parent) !== parent) throw new Error('Rust host probes require plain tool-local staging.');
  const folder = path.join(parent, randomUUID());
  await fs.mkdir(folder);
  try {
    const source = path.join(folder, 'host.rs'), output = path.join(folder, 'host.exe');
    await fs.writeFile(source, 'fn main() {}\n', { flag: 'wx' });
    const result = await command(rustc, [source, '--crate-name', 'web_app_host_probe', '--target', host, '-o', output], root, signal, { env });
    return result.code === 0 && await exists(output);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

async function inspectJdk(root, signal, policy) {
  const javacOnPath = await executable('javac');
  let home = process.env.JAVA_HOME || (javacOnPath
    ? path.dirname(path.dirname(await fs.realpath(javacOnPath))) : null);
  if (!home) {
    const studio = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Android/Android Studio/jbr')
      : process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : '/opt/android-studio/jbr';
    if (await exists(path.join(studio, 'bin/java' + (process.platform === 'win32' ? '.exe' : '')))) home = studio;
  }
  if (!home) return {};
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const java = path.join(home, 'bin/java' + suffix), javac = path.join(home, 'bin/javac' + suffix);
  if (!await exists(java) || !await exists(javac)) return { home };
  const javaResult = await command(java, ['-version'], root, signal);
  const compiler = await command(javac, ['-version'], root, signal);
  const version = javaResult.output.match(/version "([^"]+)"/)?.[1];
  const major = Number(version?.split(/[.+_-]/)[0]);
  return { home, java, javac, version, ready: javaResult.code === 0 && compiler.code === 0
    && major >= policy.minimumJdk && major <= policy.maximumJdk
    && Number(compiler.output.match(/javac (\d+)/)?.[1]) === major };
}

async function symlinkCapable(root) {
  if (process.platform !== 'win32') return true;
  const parent = path.join(root, 'tools/web_app_build_system/.local/probes');
  await fs.mkdir(parent, { recursive: true });
  if (await fs.realpath(parent) !== parent) throw new Error('Android capability probes require a plain tool-local directory.');
  const attempt = path.join(parent, randomUUID());
  await fs.mkdir(attempt);
  try {
    await fs.writeFile(path.join(attempt, 'source'), 'JNI symlink capability probe');
    await fs.symlink(path.join(attempt, 'source'), path.join(attempt, 'link'), 'file');
    return (await fs.readFile(path.join(attempt, 'link'), 'utf8')) === 'JNI symlink capability probe';
  } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return false; throw error; }
  finally { await fs.rm(attempt, { recursive: true, force: true }); }
}

async function inspectCli(root, web, signal) {
  const folder = path.join(root, '.runner/web-app-tauri');
  const recipe = JSON.parse(await fs.readFile(path.join(folder, 'cli-package.json'), 'utf8'));
  const cliRoot = path.join(folder, 'cache/cli');
  let cli, version;
  try {
    if (await fs.realpath(cliRoot) !== cliRoot) throw new Error('CLI cache indirection.');
    const local = JSON.parse(await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8'));
    const installed = JSON.parse(await fs.readFile(path.join(cliRoot, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'));
    const semver = web.cli ? createRequire(web.cli)('semver') : null;
    if (JSON.stringify(local) === JSON.stringify(recipe)
        && semver?.satisfies(installed.version, recipe.devDependencies['@tauri-apps/cli'])) {
      const candidate = path.join(cliRoot, 'node_modules/@tauri-apps/cli/tauri.js');
      const versionResult = await command(process.execPath, [candidate, '--version'], root, signal);
      const init = await command(process.execPath, [candidate, 'android', 'init', '--help'], root, signal);
      const build = await command(process.execPath, [candidate, 'android', 'build', '--help'], root, signal);
      if (versionResult.code === 0 && versionResult.stdout === 'tauri-cli ' + installed.version
          && init.code === 0 && ['--ci', '--skip-targets-install', '--config'].every(flag => init.stdout.includes(flag)) && build.code === 0
          && ['--apk', '--aab', '--debug', '--target', '--config', '--ci'].every(flag => build.stdout.includes(flag))) {
        cli = candidate; version = installed.version;
      }
    }
  } catch { signal.throwIfAborted(); }
  return { recipe, cliRoot, cli, version };
}

export async function inspectAndroid(root, signal) {
  const selection = await runtimeSelection(root, true,
    'Android packaging also requires a compatible full JDK, Android SDK/NDK, Rust host/Android targets and Tauri mobile CLI; SDK license actions remain user-owned.');
  if (!selection.enabled) return { ...selection, ready: false, preparable: false };
  if (!['win32', 'linux', 'darwin'].includes(process.platform)
      || (process.platform === 'darwin' ? !['x64', 'arm64'].includes(process.arch) : process.arch !== 'x64')) {
    return { enabled: true, ready: false, preparable: false, verificationStatus: 'unavailable',
      hints: ['Android native verification requires a supported Windows, Linux or macOS x64/arm64 host.'] };
  }
  const policy = JSON.parse(await fs.readFile(new URL('./toolchain.json', import.meta.url), 'utf8'));
  const web = await inspectEnvironment(root, signal), requirements = [], hints = [];
  const requireTool = (id, ready, action, message, extra = {}) => {
    if (!ready) {
      requirements.push({ id, action, message, ...extra });
      hints.push((action === 'external' ? 'User/external action: ' : 'Automatic preparation when permitted: ') + message);
    }
  };
  requireTool('frontend', web.ready, web.preparable ? 'npm-frontend' : 'external', web.hints.join('; '));
  const jdk = await inspectJdk(root, signal, policy);
  requireTool('windows-jni-symlinks', await symlinkCapable(root), 'external',
    'Windows JNI staging requires non-elevated file symlink permission. Enable an approved Developer Mode/policy setting yourself or use an already capable host, then retry. This tool does not elevate or change system settings.');
  requireTool('jdk', jdk.ready, 'external', 'Install a compatible full JDK (' + policy.minimumJdk + '–'
    + policy.maximumJdk + '), set JAVA_HOME for your user/terminal, then retry Prepare. No installer elevation is performed.');
  const sdk = await inspectSdk(root, jdk, policy, signal);
  requirements.push(...sdk.requirements);
  hints.push(...sdk.requirements.map(item => (item.action === 'external'
    ? 'User/external action: ' : 'Automatic preparation when permitted: ') + item.message));
  const rustup = await executable('rustup'), rustc = await executable('rustc'), cargo = await executable('cargo');
  let rustToolchain, rustVersion, cargoVersion, rustHost, hostTools;
  let developerEnvironment = {};
  if (rustup) {
    const active = await command(rustup, ['show', 'active-toolchain'], root, signal);
    if (active.code === 0) rustToolchain = active.stdout.match(/^(\S+)/)?.[1];
  }
  const env = rustToolchain ? { RUSTUP_TOOLCHAIN: rustToolchain } : {};
  if (rustc && cargo) {
    let rust = await command(rustc, ['--version', '--verbose'], root, signal, { env });
    let cargoResult = await command(cargo, ['--version'], root, signal, { env });
    rustVersion = rust.output.match(/rustc (\d+\.\d+\.\d+)/)?.[1];
    cargoVersion = cargoResult.output.match(/cargo (\d+\.\d+\.\d+)/)?.[1];
    const atLeast = version => {
      const [major, minor] = (version || '0.0').split('.').map(Number);
      return major > 1 || major === 1 && minor >= 90;
    };
    if (rustup && (!atLeast(rustVersion) || !atLeast(cargoVersion))) {
      const host = rust.output.match(/host: (\S+)/)?.[1];
      if (host) {
        rustToolchain = 'stable-' + host;
        env.RUSTUP_TOOLCHAIN = rustToolchain;
        rust = await command(rustc, ['--version', '--verbose'], root, signal, { env });
        cargoResult = await command(cargo, ['--version'], root, signal, { env });
        rustVersion = rust.output.match(/rustc (\d+\.\d+\.\d+)/)?.[1];
        cargoVersion = cargoResult.output.match(/cargo (\d+\.\d+\.\d+)/)?.[1];
      }
    }
    requireTool('rust-version', rust.code === 0 && cargoResult.code === 0 && atLeast(rustVersion) && atLeast(cargoVersion),
      rustup ? 'rustup-toolchain' : 'external', 'Prepare Rust/Cargo >= 1.90 through the existing rustup installation, or install Rust yourself.');
    rustHost = rust.output.match(/host: (\S+)/)?.[1];
    if (process.platform === 'win32' && rustHost?.endsWith('-windows-msvc')) {
      hostTools = await windowsTools(root, signal, { inspectWebview: false });
      developerEnvironment = hostTools.developerEnvironment || {};
      requireTool('windows-host-cpp', hostTools.cpp, 'external', 'Install compatible Microsoft C++ Build Tools for Windows MSVC Rust host build scripts; Android output still uses the NDK. No elevation is performed.');
      requireTool('windows-host-sdk', hostTools.sdk, 'external', 'Install a compatible Windows SDK for the selected MSVC host linker, then retry. WebView2 and NSIS are not Android prerequisites.');
    }
    if (rust.code === 0 && rustHost
        && (!hostTools || hostTools.cpp && hostTools.sdk)) {
      requireTool('host-linker', await hostLink(root, rustc, rustHost, { ...developerEnvironment, ...env }, signal), 'external',
        'The selected Rust host cannot link Cargo build scripts. Repair its host compiler/linker and libraries (MSVC/Windows SDK, GNU/MinGW, or platform C/Xcode command-line tools as applicable), then retry.');
    }
    for (const target of androidTargets) {
      const library = await command(rustc, ['--print', 'target-libdir', '--target', target], root, signal, { env });
      const standard = library.code === 0 && (await fs.readdir(library.stdout).catch(() => []))
        .find(name => /^libstd.*\.rlib$/.test(name));
      const ready = library.code === 0 && standard && (await fs.stat(path.join(library.stdout, standard))).size > 0;
      requireTool('rust-' + target, ready, rustup && rustToolchain ? 'rustup-target' : 'external',
        'Prepare Rust target ' + target + ' for the selected toolchain.', { target });
    }
  } else {
    requireTool('rust', false, 'external', 'Install Rust/Cargo with rustup for your user, open a fresh terminal and retry Prepare.');
    for (const target of androidTargets) requireTool('rust-' + target, false, 'external',
      'After installing Rust, prepare Android standard library target ' + target + '.', { target });
  }
  if (rustup && !rustToolchain) requireTool('rust-toolchain', false, 'external', 'Repair rustup active-toolchain selection before preparation.');
  const mobile = await inspectCli(root, web, signal);
  requireTool('tauri-mobile-cli', mobile.cli, 'npm-cli', 'Prepare the declared Tauri 2 CLI with Android init/build capability in the existing runtime cache.');
  const verifier = await inspectVerifier(root, jdk, policy.bundletool, signal);
  requireTool('aab-verifier', verifier.ready, 'bundletool', 'Prepare checksum-verified Google bundletool for read-only AAB verification in the shared user cache.');
  return { enabled: true, ready: requirements.length === 0, preparable: requirements.some(item => item.action !== 'external'),
    verificationStatus: 'not-yet-verified', requirements, hints, web, jdk, sdk, policy, rustup, rustc, cargo, rustToolchain,
    ...mobile, verifier, developerEnvironment, versions: { node: process.version, jdk: jdk.version, rust: rustVersion, cargo: cargoVersion,
      rustHost, hostMsvc: hostTools?.msvcVersion, hostWindowsSdk: hostTools?.sdkVersion,
      rustToolchain, tauriCli: mobile.version, bundletool: verifier.version, ...sdk.versions } };
}

export async function prepareAndroid(root, environment, signal, stage, allowed) {
  if (!environment.enabled || environment.verificationStatus === 'unavailable') throw new Error(environment.hints.join('\n'));
  let current = await inspectAndroid(root, signal);
  if (!current.enabled || current.verificationStatus === 'unavailable') throw new Error(current.hints.join('\n'));
  if (current.ready) return current;
  if (!allowed) throw new Error('Installation is disabled by allowDependencyInstall. Prepare the listed Android prerequisites yourself or enable permitted user-level installation.');
  const blockers = current.requirements.filter(item => item.action === 'external' && item.id !== 'sdk-licenses');
  if (blockers.length) throw new Error('External installation/user action required:\n' + blockers.map(item => item.message).join('\n'));
  if (!current.web.ready) await prepareFrontend(root, current.web, signal, stage, allowed);
  if (!current.cli) {
    stage('Preparing Tauri mobile CLI', 'Installing the declared CLI into the existing runtime cache; source and lockfiles stay intact. Ctrl+C cancels.');
    await fs.mkdir(current.cliRoot, { recursive: true });
    if (await fs.realpath(current.cliRoot) !== current.cliRoot) throw new Error('Tauri CLI cache must be a plain checkout directory.');
    await fs.writeFile(path.join(current.cliRoot, 'package.json'), JSON.stringify(current.recipe, null, 2) + '\n');
    if (await npm(current.web.cli, ['install', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], current.cliRoot, signal) !== 0) {
      throw new Error('Tauri mobile CLI preparation failed; resolve registry/access errors and retry.');
    }
  }
  if (current.requirements.some(item => item.action === 'rustup-toolchain')) {
    stage('Preparing Rust toolchain', 'Updating the selected user toolchain without changing the global default; Ctrl+C cancels.');
    if ((await command(current.rustup, ['toolchain', 'install', current.rustToolchain, '--profile', 'minimal'],
      root, signal, { quiet: false })).code !== 0) throw new Error('Rust preparation failed; check rustup output and retry.');
  }
  for (const requirement of current.requirements.filter(item => item.action === 'rustup-target')) {
    stage('Preparing Rust Android target', 'Installing ' + requirement.target + '; Ctrl+C cancels.');
    if ((await command(current.rustup, ['target', 'add', requirement.target, '--toolchain', current.rustToolchain],
      root, signal, { quiet: false })).code !== 0) throw new Error('Rust Android target preparation failed: ' + requirement.target);
  }
  await prepareSdk(root, current.sdk, current.jdk, current.policy, signal, stage);
  await prepareVerifier(root, current.jdk, current.policy.bundletool, signal, stage);
  current = await inspectAndroid(root, signal);
  if (!current.ready) throw new Error('Android preparation is incomplete:\n' + current.hints.join('\n'));
  stage('Android/Tauri environment ready', 'Reinspected the selected JDK, SDK/NDK, Rust targets and mobile CLI; continuing the requested action.');
  return current;
}
