import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { configuration, inputs, treeHash, npm } from './project.mjs';
import { verifyOutput } from './output.mjs';
import { command } from './native/process.mjs';
import { inspectAndroid, prepareAndroid } from './android/environment.mjs';
import { stageAndroid, androidCargo, androidSourceHash } from './android/staging.mjs';
import { configureGradle } from './android/gradle.mjs';
import { verifyAndroidProducts } from './android/products.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function nativeInputs(root, config, environment) {
  return hash(JSON.stringify({ frontend: await inputs(root, config.output, config.excludeTestResults),
    android: await androidSourceHash(root), cli: await treeHash(environment.cliRoot), versions: environment.versions }));
}
async function outputs(folder, extension) {
  const files = [];
  async function visit(directory) {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Android outputs cannot contain filesystem indirection.');
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile() && name.endsWith(extension)) files.push(file);
    }
  }
  await visit(folder);
  if (files.length !== 1) throw new Error('Expected exactly one newly generated ' + extension + ' in the selected Android output.');
  return files[0];
}

export const androidAdapter = {
  inspect: inspectAndroid,
  prepare: prepareAndroid,
  async build({ root, output, environment, signal, stage, config: buildConfig }) {
    const config = await configuration(root), before = await nativeInputs(root, config, environment);
    const workspace = path.join(path.dirname(output), 'android');
    const frontend = path.join(workspace, 'frontend'), cargoOutput = path.join(workspace, 'cargo');
    await fs.mkdir(workspace);
    try {
      stage('Building Android frontend', 'Building the current TypeScript/Vite frontend into private staging; Ctrl+C cancels.');
      const outDir = path.relative(root, frontend).split(path.sep).join('/');
      if (await npm(environment.web.cli, ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir', '--base', './'], root, signal) !== 0) {
        throw new Error('Android frontend build failed. Earlier Web/native products and original source remain intact.');
      }
      await verifyOutput(frontend);
      const { backend, generated, config: nativeConfig } = await stageAndroid(root, workspace, frontend);
      const priorLock = await fs.readFile(path.join(backend, 'Cargo.lock')).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const { env, library } = await androidCargo(environment, backend, cargoOutput, signal, buildConfig.allowDependencyInstall);
      Object.assign(env, { TAURI_APP_PATH: backend, TAURI_FRONTEND_PATH: workspace,
        GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'),
        ANDROID_USER_HOME: path.join(workspace, 'android-user'), CI: 'true',
        npm_execpath: undefined, npm_lifecycle_event: undefined, npm_lifecycle_script: undefined });
      const override = path.join(workspace, 'android-config.json');
      await fs.writeFile(override, JSON.stringify({ build: nativeConfig.build, bundle: nativeConfig.bundle }) + '\n', { flag: 'wx' });
      if (!await fs.access(generated).then(() => true, () => false)) {
        stage('Initializing Android project', 'Running official Tauri Android init in staging; user Android sources stay intact. Ctrl+C cancels.');
        const initialized = await command(process.execPath, [environment.cli, 'android', 'init', '--ci',
          '--skip-targets-install', '--config', override], backend, signal, { env, quiet: false });
        if (initialized.code !== 0) throw new Error('Tauri Android initialization failed; check selected JDK/SDK/NDK and generated resources. Original sources and locks are preserved.');
      }
      await configureGradle(generated, environment, buildConfig.allowDependencyInstall, env, signal);
      stage('Packaging Android / Tauri 2', 'Compiling arm64 unsigned local/test APK and AAB through official Tauri Android build; no signing keys are created. Ctrl+C cancels.');
      const built = await command(process.execPath, [environment.cli, 'android', 'build', '--ci', '--apk', '--aab',
        '--target', 'aarch64', '--config', override, '--', '--locked',
        ...(!buildConfig.allowDependencyInstall ? ['--offline'] : [])], backend, signal, { env, quiet: false });
      if (built.code !== 0) throw new Error('Android compilation or APK/AAB packaging failed. Check native output and SDK/symlink prerequisites; earlier results and source/locks are preserved.');
      const nativeLock = await fs.readFile(path.join(backend, 'Cargo.lock'));
      if (priorLock && !priorLock.equals(nativeLock)) throw new Error('Android build changed the staged copy of the original Cargo.lock; resolve dependency compatibility. The checkout lock remains unchanged.');
      const buildOutputs = path.join(generated, 'app/build/outputs');
      const apk = await outputs(path.join(buildOutputs, 'apk'), '.apk');
      const aab = await outputs(path.join(buildOutputs, 'bundle'), '.aab');
      await fs.mkdir(output);
      for (const file of [apk, aab]) await fs.copyFile(file, path.join(output, path.basename(file)), fs.constants.COPYFILE_EXCL);
      stage('Verifying Android products', 'Checking full ZIP integrity, package/version, DEX, arm64 native library and bundletool validation; Ctrl+C cancels.');
      const integrity = await verifyAndroidProducts(output, { identifier: nativeConfig.identifier.replaceAll('-', '_'),
        productName: nativeConfig.productName, version: nativeConfig.version, library, nativeLock: hash(nativeLock) }, environment, signal);
      const current = await inspectAndroid(root, signal);
      if (!current.ready || await nativeInputs(root, config, current) !== before) {
        throw new Error('Checkout source or selected Android/frontend toolchain changed during packaging. Retry with stable inputs; earlier results are preserved.');
      }
      stage('Unsigned Android products verified', 'APK/AAB are local/test products requiring separate signing before installation or store upload. Device/emulator acceptance remains unverified.');
      return { verificationStatus: 'verified', integrity, inputs: hash(before + '\0' + hash(nativeLock)) };
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
  },
};
