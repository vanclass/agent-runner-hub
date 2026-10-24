import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { configuration, inputs, npm, treeHash } from './project.mjs';
import { verifyOutput } from './output.mjs';
import { command } from './native/process.mjs';
import { inspectWindowsElectron, prepareWindowsElectron } from './electron/environment.mjs';
import { verifyElectronProducts } from './electron/products.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function buildInputs(root, config, environment) {
  return { frontend: await inputs(root, config.output, config.excludeTestResults),
    runtime: await treeHash(environment.runtime.runtime.modules),
    // Squirrel writes this generated log beside its vendor binary on every make.
    forge: await treeHash(environment.tools, key => key === 'node_modules/electron-winstaller/vendor/Squirrel-Releasify.log'),
    adapter: await treeHash(path.join(root, 'tools/web_app_build_system/src')), versions: JSON.stringify(environment.versions) };
}
export async function installerMetadata(root, environment) {
  const config = JSON.parse(await fs.readFile(path.join(root, '.runner/web-app-electron/app-config.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const author = typeof pkg.author === 'object' ? pkg.author?.name : pkg.author;
  const identity = { target: 'windows-electron', name: config.name,
    productName: pkg.productName || config.productName, author: author || config.author,
    description: pkg.description || config.description, version: pkg.version,
    squirrelVersion: environment.runtime.runtime.squirrelVersion, versions: environment.versions };
  if (config.schema !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(identity.name) || !/^\d+\.\d+\.\d+$/.test(identity.version)
      || ['productName', 'author', 'description'].some(key => typeof identity[key] !== 'string' || !identity[key].trim()
        || /[\x00-\x1f]/.test(identity[key]))) throw new Error('Provide schema 1 installer metadata, a safe lowercase package name, productName, author, description and a stable numeric major.minor.patch project version. Edit Electron app-config.json/root explicit settings; root metadata is never overwritten.');
  return identity;
}

export const electronAdapter = {
  inspect: inspectWindowsElectron,
  prepare: prepareWindowsElectron,
  async build({ root, output, environment, signal, stage }) {
    const config = await configuration(root);
    const before = await buildInputs(root, config, environment);
    const identity = await installerMetadata(root, environment);
    // Squirrel's .NET backend requires short paths, even on long-path-enabled Windows.
    // This invocation owns and always removes its private native workspace.
    const temporaryRoot = await fs.realpath(os.tmpdir());
    const workspace = await fs.mkdtemp(path.join(temporaryRoot, 'runner-electron-'));
    const application = path.join(workspace, 'source');
    const frontend = path.join(application, 'frontend');
    try {
      await fs.mkdir(application, { recursive: true });
      stage('Building Electron frontend', 'Running the existing TypeScript/Vite build in staging. Ctrl+C cancels; previous products remain intact.');
      const outDir = path.relative(root, frontend).split(path.sep).join('/');
      if (await npm(environment.runtime.web.cli, ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir', '--base', './'], root, signal) !== 0) throw new Error('TypeScript/Vite compilation failed. Source and earlier Web/native products are preserved.');
      await verifyOutput(frontend, './');
      await fs.cp(path.join(root, '.runner/web-app-electron/app'), path.join(application, 'app'), { recursive: true, dereference: false });
      const modules = environment.runtime.runtime.modules;
      await fs.cp(modules, path.join(application, 'node_modules'), { recursive: true, dereference: false,
        filter: source => path.relative(modules, source).split(path.sep)[0] !== '.bin' });
      const pkg = { name: identity.name, productName: identity.productName, version: identity.version,
        author: identity.author, description: identity.description, main: 'app/main.cjs', private: true,
        dependencies: { ...environment.runtime.recipe.dependencies, 'electron-squirrel-startup': identity.squirrelVersion },
        devDependencies: { electron: environment.versions.electron }, config: { forge: './forge.config.cjs' } };
      await fs.writeFile(path.join(application, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      const require = createRequire(path.join(environment.tools, 'package.json'));
      const maker = require.resolve('@electron-forge/maker-squirrel');
      const forgeConfig = {
        packagerConfig: { asar: false, name: identity.productName, executableName: identity.name,
          appVersion: identity.version, buildVersion: identity.version,
          electronVersion: environment.versions.electron, electronDist: path.dirname(environment.runtime.binary),
          win32metadata: { CompanyName: identity.author, FileDescription: identity.description,
            ProductName: identity.productName, InternalName: identity.name, OriginalFilename: identity.name + '.exe' } },
        makers: [{ name: maker, config: { name: identity.name, authors: identity.author, description: identity.description,
          exe: identity.name + '.exe', setupExe: identity.name + '-' + identity.version + '-Setup.exe', noMsi: true } }]
      };
      await fs.writeFile(path.join(application, 'forge.config.cjs'), 'module.exports = ' + JSON.stringify(forgeConfig, null, 2) + ';\n');
      stage('Packaging Windows / Electron', 'Electron Forge packages Chromium and creates a Squirrel.Windows installer. Native modules may require Python/MSVC/SDK externally; no elevation is performed. Ctrl+C cancels.');
      const result = await command(process.execPath, [environment.forge.forge, 'make', '--platform', 'win32', '--arch', 'x64'], application, signal,
        { quiet: false, env: { ELECTRON_RUN_AS_NODE: undefined } });
      if (result.code !== 0) throw new Error('Electron Forge/Squirrel packaging failed. Check compiler/native-module ABI, network, antivirus and filesystem diagnostics. Install externally required Python/MSVC/SDK prerequisites yourself, then retry; source, locks and prior results are preserved.');
      const packaged = (await fs.readdir(path.join(application, 'out'), { withFileTypes: true }))
        .filter(item => item.isDirectory() && item.name.endsWith('-win32-x64'));
      if (packaged.length !== 1) throw new Error('Expected exactly one fresh Windows x64 Electron packaged application.');
      const installers = path.join(application, 'out/make/squirrel.windows/x64');
      await fs.mkdir(output);
      await fs.cp(path.join(application, 'out', packaged[0].name), path.join(output, 'application'), { recursive: true, dereference: false });
      await fs.cp(installers, path.join(output, 'installer'), { recursive: true, dereference: false });
      stage('Verifying Electron products', 'Checking executable/installer shape, staged package metadata, NuGet/RELEASES integrity and unchanged checkout inputs.');
      const integrity = await verifyElectronProducts(output, identity);
      const current = await inspectWindowsElectron(root, signal);
      const after = current.ready ? await buildInputs(root, config, current) : {};
      const changed = Object.keys(before).filter(key => before[key] !== after[key]);
      if (!current.ready || changed.length) throw new Error('Checkout inputs or installed runtime/packaging dependencies changed during packaging (' + changed.join(', ') + '). Retry with stable inputs; earlier products remain intact.');
      return { verificationStatus: 'verified', integrity, inputs: hash(JSON.stringify(before)) };
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
  },
};
