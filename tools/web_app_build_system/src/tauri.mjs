import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configuration, inputs, npm, treeHash } from './project.mjs';
import { verifyOutput } from './output.mjs';
import { inspectNative, prepareNative, targetTriple } from './native/environment.mjs';
import { command } from './native/process.mjs';
import { stageBackend, ownedOverride, prepareCargo } from './native/staging.mjs';
import { verifyProducts } from './native/products.mjs';
import { copyNsis } from './native/nsis.mjs';
import { copyMacProducts, verifyMacProducts } from './native/macos-products.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

async function nativeInputs(root, config, environment) {
  return hash(JSON.stringify({ frontend: await inputs(root, config.output, config.excludeTestResults),
    cli: await treeHash(environment.cliRoot), nsis: environment.nsis ? await treeHash(environment.nsis.folder) : null, versions: environment.versions }));
}

export const tauriAdapter = {
  inspect: (root, signal) => inspectNative(root, signal, { buildSystem: true, expectedPlatform: 'win32' }),
  prepare: prepareNative,
  async build({ root, output, environment, signal, stage, config: buildConfig }) {
    const macos = environment.platform === 'darwin';
    const triple = environment.targetTriple || targetTriple;
    const config = await configuration(root);
    const before = await nativeInputs(root, config, environment);
    const attempt = path.dirname(output);
    const workspace = path.join(attempt, 'native');
    const frontend = path.join(workspace, 'frontend');
    const backend = path.join(workspace, 'src-tauri');
    const cargoOutput = path.join(workspace, 'cargo');
    await fs.mkdir(workspace);
    try {
      stage('Building native frontend', 'Running the existing TypeScript/Vite build into this execution’s staging directory; Ctrl+C cancels.');
      const outDir = path.relative(root, frontend).split(path.sep).join('/');
      if (await npm(environment.web.cli, ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir', '--base', './'], root, signal) !== 0) {
        throw new Error('The existing TypeScript/Vite frontend build failed. Earlier Web/native products remain intact.');
      }
      await verifyOutput(frontend);
      const nativeConfig = await stageBackend(root, backend);
      const priorLock = await fs.readFile(path.join(backend, 'Cargo.lock')).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const env = await prepareCargo({ ...environment, allowDependencyInstall: buildConfig?.allowDependencyInstall },
        backend, cargoOutput, signal, command);
      const metadata = await command(environment.cargo, ['metadata', '--no-deps', '--format-version', '1',
        '--manifest-path', path.join(backend, 'Cargo.toml')], backend, signal, { env });
      if (metadata.code !== 0) throw new Error('Staged Cargo metadata failed: ' + metadata.output + '. Preserve custom workspaces/path dependencies and resolve their staging integration.');
      if (metadata.truncated) throw new Error('Cargo metadata exceeded the supported staged crate boundary; preserve the custom workspace and resolve its staging integration.');
      const graph = JSON.parse(metadata.stdout);
      if (path.resolve(graph.target_directory) !== cargoOutput) throw new Error('Cargo output escaped the execution-specific target directory.');
      if (!macos) await copyNsis(environment, graph.target_directory, root, signal);
      const pkg = graph.packages.find(item => path.resolve(item.manifest_path) === path.join(backend, 'Cargo.toml'));
      const tauriDependencies = pkg?.dependencies?.filter(item => item.name === 'tauri' && !item.kind) || [];
      if (!tauriDependencies.length || tauriDependencies.some(item => !/^[~^=]?\s*2(?:\.(?:\d+|\*)){0,2}$/.test(item.req))) {
        throw new Error('The native backend must explicitly declare compatible Tauri 2 dependencies. Resolve custom Cargo integration; original source and locks are preserved.');
      }
      const binaries = pkg?.targets.filter(target => target.kind.includes('bin')) || [];
      const binaryName = nativeConfig.mainBinaryName || pkg?.default_run || (binaries.length === 1 ? binaries[0].name : null);
      if (!binaryName || !binaries.some(item => item.name === binaryName) || /[/\\]/.test(binaryName)) {
        throw new Error('Native main binary identity is ambiguous. Set a compatible Cargo default-run/mainBinaryName before retrying.');
      }
      stage('Packaging ' + (macos ? 'macOS' : 'Windows') + ' / Tauri 2', 'Compiling ' + triple + ' and native bundles in staging; Ctrl+C cancels.');
      const override = ownedOverride(frontend, undefined, macos ? 'darwin' : 'win32');
      const built = await command(process.execPath, [environment.cli, 'build', '--target', triple,
        '--config', JSON.stringify(override), '--bundles', macos ? 'app,dmg' : 'nsis', '--ci',
        ...(macos ? ['--no-sign'] : []), '--', '--locked'], backend, signal,
        { env, quiet: false });
      if (built.code !== 0) throw new Error('Tauri native compilation or packaging failed. Check the native tool output; original native source, lockfiles and earlier products are preserved.');
      const nativeLock = await fs.readFile(path.join(backend, 'Cargo.lock'));
      if (priorLock && !priorLock.equals(nativeLock)) throw new Error('Tauri changed the staged copy of the existing Cargo.lock. Resolve its managed feature/dependency compatibility; the original lockfile is unchanged.');
      const release = path.join(cargoOutput, triple, 'release');
      if (macos) await copyMacProducts(release, output);
      else {
        const nsis = path.join(release, 'bundle/nsis');
        const installers = (await fs.readdir(nsis)).filter(name => name.endsWith('-setup.exe'));
        if (installers.length !== 1) throw new Error('Expected one newly generated NSIS installer in the selected target output.');
        await fs.mkdir(output);
        await fs.copyFile(path.join(release, binaryName + '.exe'), path.join(output, binaryName + '.exe'), fs.constants.COPYFILE_EXCL);
        await fs.copyFile(path.join(nsis, installers[0]), path.join(output, installers[0]), fs.constants.COPYFILE_EXCL);
      }
      stage('Verifying native products', 'Checking native architecture, bundle identity, integrity and stable checkout inputs. Signing, installation and GUI execution are unverified.');
      const identity = { target: macos ? 'macos-tauri' : 'windows-tauri', targetTriple: triple, identifier: nativeConfig.identifier,
        productName: nativeConfig.productName, version: nativeConfig.version, binary: binaryName,
        nativeLock: hash(nativeLock), versions: environment.versions, signatureStatus: 'not-verified',
        guiVerificationStatus: 'not-verified', installerExecutionStatus: 'not-executed' };
      const integrity = macos ? await verifyMacProducts(output, identity, signal) : await verifyProducts(output, identity);
      const currentEnvironment = await inspectNative(root, signal, { buildSystem: true, expectedPlatform: macos ? 'darwin' : 'win32' });
      if (!currentEnvironment.ready || await nativeInputs(root, config, currentEnvironment) !== before) {
        throw new Error('Checkout source or native/frontend dependencies changed during packaging. Retry with stable inputs; earlier results are preserved.');
      }
      return { verificationStatus: 'verified', integrity, inputs: hash(before + '\0' + hash(nativeLock)) };
    } finally {
      // This UUID staging workspace was allocated by the current result attempt.
      await fs.rm(workspace, { recursive: true, force: true });
    }
  },
};

export const macosTauriAdapter = { ...tauriAdapter,
  inspect: (root, signal) => inspectNative(root, signal, { buildSystem: true, expectedPlatform: 'darwin' }),
};
