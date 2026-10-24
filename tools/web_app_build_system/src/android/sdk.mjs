import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { probe as command } from './probe.mjs';
import { extractTools } from './archive.mjs';

const exists = file => fs.stat(file).then(stat => stat.isFile(), () => false);
const properties = async folder => {
  const text = await fs.readFile(path.join(folder, 'source.properties'), 'utf8').catch(() => '');
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes('='))
    .map(line => line.split(/=(.*)/s).slice(0, 2).map(value => value.trim())));
};
function defaultSdk() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Android/Sdk');
  return path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
}
async function protectedSdk(folder) {
  let parent = folder, remainder = [];
  while (true) {
    const resolved = await fs.realpath(parent).catch(() => null);
    if (resolved) { folder = path.join(resolved, ...remainder); break; }
    const next = path.dirname(parent);
    if (next === parent) break;
    remainder.unshift(path.basename(parent)); parent = next;
  }
  const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
  folder = comparable(folder);
  return [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
    process.env.ProgramData, ...(process.platform === 'win32' ? [] : ['/usr', '/opt', '/System', '/Library', '/etc', '/var', '/bin', '/sbin', '/lib', '/root'])]
    .filter(Boolean).some(root => folder === comparable(path.resolve(root)) || folder.startsWith(comparable(path.resolve(root)) + path.sep));
}
const revision = value => (value || '').split('.').map(Number);
function newer(a, b) {
  const first = revision(a), second = revision(b);
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    if ((first[index] || 0) !== (second[index] || 0)) return (first[index] || 0) > (second[index] || 0);
  }
  return false;
}

export function sdkEnvironment(sdk, jdk, basePath = process.env.PATH || '') {
  return { JAVA_HOME: jdk.home, ANDROID_HOME: sdk.home, ANDROID_SDK_ROOT: sdk.home, NDK_HOME: sdk.ndk,
    PATH: [path.join(jdk.home, 'bin'), path.join(sdk.home, 'platform-tools'), basePath].join(path.delimiter) };
}

export async function sdkCommand(root, jdk, manager, home, args, signal, quiet = true) {
  return command(jdk.java, ['-Dcom.android.sdklib.toolsdir=' + manager, '-classpath', path.join(manager, 'lib/sdkmanager-classpath.jar'),
    'com.android.sdklib.tool.sdkmanager.SdkManagerCli', '--sdk_root=' + home, ...args], root, signal,
  { env: { JAVA_HOME: jdk.home }, quiet });
}

export async function inspectSdk(root, jdk, policy, signal) {
  const home = path.resolve(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdk());
  const requirements = [];
  const missing = (id, condition, action, message, extra = {}) => {
    if (!condition) requirements.push({ id, action, message, ...extra });
  };
  const identity = async value => {
    const resolved = await fs.realpath(path.resolve(value)).catch(() => path.resolve(value));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  missing('sdk-selection', !process.env.ANDROID_HOME || !process.env.ANDROID_SDK_ROOT
    || await identity(process.env.ANDROID_HOME) === await identity(process.env.ANDROID_SDK_ROOT), 'external',
  'ANDROID_HOME and ANDROID_SDK_ROOT disagree. Select one SDK for this terminal and retry.');
  let manager, managerVersion;
  const tools = path.join(home, 'cmdline-tools');
  const candidates = [];
  for (const name of await fs.readdir(tools).catch(() => [])) {
    const folder = path.join(tools, name), props = await properties(folder);
    if (await exists(path.join(folder, 'lib/sdkmanager-classpath.jar'))) candidates.push({ folder, version: props['Pkg.Revision'] });
  }
  candidates.sort((a, b) => newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0);
  for (const candidate of candidates) {
    if (!jdk.ready) { manager = candidate.folder; managerVersion = candidate.version; break; }
    const result = await sdkCommand(root, jdk, candidate.folder, home, ['--version'], signal);
    if (result.code === 0 && /\d/.test(result.stdout)) { manager = candidate.folder; managerVersion = candidate.version || result.stdout; break; }
  }
  missing('sdk-command-line-tools', manager, 'sdk-tools', 'Prepare Android Command-line Tools in the selected SDK: ' + home + '. Compatible existing tools are reused.');
  const platform = path.join(home, ...policy.platformPackage.split(';'));
  const buildTools = path.join(home, 'build-tools', policy.buildTools);
  const ndk = path.resolve(process.env.NDK_HOME || path.join(home, 'ndk', policy.ndkVersion));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const aapt2 = path.join(buildTools, 'aapt2' + suffix), adb = path.join(home, 'platform-tools/adb' + suffix);
  const ndkProps = await properties(ndk), buildProps = await properties(buildTools);
  const platformProps = await properties(platform);
  const platformMetadata = await fs.readFile(path.join(platform, 'package.xml'), 'utf8').catch(() => '');
  const hostTags = process.platform === 'win32' ? ['windows-x86_64']
    : process.platform === 'darwin' ? ['darwin-x86_64'] : ['linux-x86_64'];
  let ndkHost;
  for (const tag of hostTags) if (await exists(path.join(ndk, 'toolchains/llvm/prebuilt', tag, 'bin/clang' + suffix))) {
    ndkHost = tag; break;
  }
  missing('sdk-platform', Number(platformProps['AndroidVersion.ApiLevel']) === policy.compileSdk
    && platformMetadata.includes('path="' + policy.platformPackage + '"')
    && await exists(path.join(platform, 'android.jar')), 'sdk-package',
    'Prepare Android SDK Platform ' + policy.compileSdk + '.', { package: policy.platformPackage });
  let buildReady = buildProps['Pkg.Revision'] === policy.buildTools && await exists(aapt2);
  if (buildReady && jdk.ready) buildReady = (await command(aapt2, ['version'], root, signal)).code === 0;
  missing('sdk-build-tools', buildReady, 'sdk-package', 'Prepare Android Build-Tools ' + policy.buildTools + '.',
    { package: 'build-tools;' + policy.buildTools });
  let adbReady = await exists(adb);
  if (adbReady) adbReady = (await command(adb, ['version'], root, signal)).code === 0;
  missing('sdk-platform-tools', adbReady, 'sdk-package', 'Prepare Android Platform-Tools (adb).', { package: 'platform-tools' });
  let ndkReady = ndkProps['Pkg.Revision'] === policy.ndkVersion && Boolean(ndkHost);
  if (ndkReady) {
    const bin = path.join(ndk, 'toolchains/llvm/prebuilt', ndkHost, 'bin');
    const wrapper = process.platform === 'win32' ? '.cmd' : '';
    for (const name of ['llvm-ar' + suffix, 'llvm-readelf' + suffix,
      ...['aarch64-linux-android', 'armv7a-linux-androideabi', 'i686-linux-android', 'x86_64-linux-android']
        .flatMap(target => [target + '24-clang' + wrapper, target + '24-clang++' + wrapper])]) {
      if (!await exists(path.join(bin, name))) ndkReady = false;
    }
  }
  if (ndkReady) ndkReady = (await command(path.join(ndk, 'toolchains/llvm/prebuilt', ndkHost, 'bin/clang' + suffix),
    ['--version'], root, signal)).code === 0;
  missing('sdk-ndk', ndkReady, process.env.NDK_HOME ? 'external' : 'sdk-package',
    process.env.NDK_HOME ? 'NDK_HOME must select compatible NDK ' + policy.ndkVersion + '; repair this explicit selection and retry.'
      : 'Prepare Android NDK ' + policy.ndkVersion + '.', { package: 'ndk;' + policy.ndkVersion });
  const licenses = await fs.readFile(path.join(home, 'licenses/android-sdk-license'), 'utf8').catch(() => '');
  const licensed = licenses.split(/\r?\n/).some(value => policy.sdkLicenseHashes.includes(value.trim()));
  missing('sdk-licenses', licensed, 'external', 'User action required: run "' + path.join(manager || path.join(tools, 'latest'),
    'bin/sdkmanager' + (process.platform === 'win32' ? '.bat' : '')) + '" --sdk_root="' + home
    + '" --licenses yourself, review the required SDK licenses, then retry Prepare. Licenses are never accepted by this tool.');
  if (await protectedSdk(home) && requirements.some(item => item.action.startsWith('sdk-'))) {
    missing('sdk-protected-location', false, 'external', 'The selected SDK is in a protected system location. Reuse it read-only when complete; install missing packages yourself or select a user-level SDK.');
  }
  return { home, manager, ndk, ndkHost, aapt2, adb, licensed, requirements,
    versions: { sdk: home, commandLineTools: managerVersion, sdkPlatform: platformProps['AndroidVersion.ApiLevel'],
      buildTools: buildProps['Pkg.Revision'], ndk: ndkProps['Pkg.Revision'], ndkHost } };
}

async function acquireTools(sdk, policy, signal, stage) {
  stage('Preparing Android Command-line Tools', 'Downloading checksum-verified official tools into the selected user SDK; no licenses are accepted. Ctrl+C cancels.');
  const downloadPolicy = policy.commandLineTools.downloads[process.platform === 'darwin'
    ? 'darwin-' + process.arch : process.platform];
  if (!downloadPolicy) throw new Error('Command-line Tools preparation is unavailable on this host.');
  const parent = path.join(sdk.home, 'cmdline-tools');
  await fs.mkdir(parent, { recursive: true });
  const attempt = path.join(parent, '.runner-tauri-' + randomUUID());
  await fs.mkdir(attempt);
  try {
    const download = await fetch(downloadPolicy.url, { signal });
    if (!download.ok) throw new Error('Command-line Tools download failed: HTTP ' + download.status);
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length !== downloadPolicy.size || createHash('sha256').update(bytes).digest('hex') !== downloadPolicy.sha256) {
      throw new Error('Command-line Tools official checksum/size verification failed.');
    }
    const zip = path.join(attempt, 'tools.zip'), extracted = path.join(attempt, 'tools');
    await fs.writeFile(zip, bytes, { flag: 'wx' });
    await extractTools(zip, extracted);
    const props = await properties(extracted), version = props['Pkg.Revision'];
    if (version !== policy.commandLineTools.version || !await exists(path.join(extracted, 'lib/sdkmanager-classpath.jar'))) {
      throw new Error('Downloaded Command-line Tools are incomplete.');
    }
    const destination = path.join(parent, version);
    if (await fs.access(destination).then(() => true, () => false)) {
      throw new Error('Existing command-line tools folder needs user repair; it will not be overwritten: ' + destination);
    }
    signal.throwIfAborted();
    await fs.rename(extracted, destination);
  } finally { await fs.rm(attempt, { recursive: true, force: true }); }
}

export async function prepareSdk(root, sdk, jdk, policy, signal, stage) {
  if (!sdk.requirements.length) return;
  if (await protectedSdk(sdk.home)) throw new Error('Prepare missing SDK packages externally or select a user-level SDK; protected locations are not modified.');
  await fs.mkdir(sdk.home, { recursive: true });
  const lock = path.join(sdk.home, '.runner-web-app-prepare.lock');
  try { await fs.mkdir(lock); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Selected SDK preparation is busy. Finish the other preparation and retry.'); throw error; }
  try {
    if (!sdk.manager) await acquireTools(sdk, policy, signal, stage);
    const current = await inspectSdk(root, jdk, policy, signal);
    if (!current.licensed) throw new Error(current.requirements.find(item => item.id === 'sdk-licenses').message);
    const packages = current.requirements.filter(item => item.action === 'sdk-package').map(item => item.package);
    if (packages.length) {
      stage('Preparing Android SDK/NDK packages', 'Installing ' + packages.join(', ') + ' in the selected SDK; Ctrl+C cancels. Required licenses must already be accepted.');
      const result = await sdkCommand(root, jdk, current.manager, sdk.home, ['--install', ...packages], signal);
      if (result.code !== 0) throw new Error('SDK package preparation failed: ' + result.output + '. Resolve access/license errors and retry Prepare.');
    }
    const verified = await inspectSdk(root, jdk, policy, signal);
    if (verified.requirements.length) throw new Error('SDK preparation is incomplete:\n' + verified.requirements.map(item => item.message).join('\n'));
  } finally { await fs.rmdir(lock); }
}
