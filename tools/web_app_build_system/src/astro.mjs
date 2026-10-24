import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { appliedIntegrations, validateIntegrations } from './astro-contract.mjs';

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function localAstro(root, entry = 'astro') {
  const require = createRequire(path.join(root, 'package.json'));
  const resolved = require.resolve(entry);
  const installed = await fs.realpath(path.join(root, 'node_modules/astro'));
  if (!resolved.startsWith(installed + path.sep)) throw new Error('Astro must resolve from this checkout. Run npm ci here.');
  const version = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8')).version;
  if (!version.startsWith('6.')) throw new Error('This Foundation requires Astro 6. Preserve the project and restore compatible dependencies.');
  return import(pathToFileURL(resolved).href);
}

export async function configuration(root, permitted, recipeRoot, appliedRecipes = false) {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (packageJson.scripts?.build !== 'astro check && astro build') {
    throw new Error('Astro static launch requires the supported build script: astro check && astro build. Preserve custom scripts in a separate project.');
  }
  const configFile = path.join(root, 'astro.config.mjs');
  if (await fs.realpath(configFile) !== configFile) throw new Error('Astro config must be a plain checkout-local astro.config.mjs.');
  for (const name of ['astro.config.js', 'astro.config.ts', 'astro.config.cjs', 'astro.config.mts', 'astro.config.cts']) {
    if (await fs.access(path.join(root, name)).then(() => true, () => false)) throw new Error('Only one astro.config.mjs is supported. Preserve the other config and resolve this ambiguity.');
  }
  const { default: user } = await import(pathToFileURL(configFile).href);
  if (!user || typeof user !== 'object' || Array.isArray(user) || user.adapter
      || user.vite && (typeof user.vite !== 'object' || Array.isArray(user.vite))
      || user.vite?.build || user.build?.client || user.build?.server) {
    throw new Error('This Foundation supports static object configuration without adapters or build-output overrides.');
  }
  await validateIntegrations(root, user, permitted ?? await appliedIntegrations(root), recipeRoot, appliedRecipes);
  const { validateConfig } = await localAstro(root, 'astro/config');
  const config = await validateConfig(user, root, 'build');
  if (config.output !== 'static' || config.base !== '/' || path.resolve(fileURLToPath(config.root)) !== root) {
    throw new Error('Astro must build a static site with base / from this exact checkout root.');
  }
  const paths = [config.srcDir, config.publicDir, config.outDir, config.cacheDir].map(url => fileURLToPath(url));
  for (const value of paths) {
    const target = path.resolve(value);
    if (!inside(root, target)) throw new Error('Astro source, public, output and cache paths must stay inside this checkout.');
    let ancestor = target;
    while (!await fs.access(ancestor).then(() => true, () => false)) ancestor = path.dirname(ancestor);
    if (await fs.realpath(ancestor) !== ancestor) throw new Error('Astro paths must not use filesystem indirection.');
  }
  const [source, publicDir, output, cache] = paths.map(value => path.resolve(value));
  const first = path.relative(root, output).split(path.sep)[0];
  if (!first || ['node_modules', '.runner', '.git', '.astro', 'src', 'public', 'tests', 'tools'].includes(first)
      || [source, publicDir].some(value => inside(output, value))
      || cache !== path.join(root, 'node_modules/.astro')) {
    throw new Error('Astro output must be a dedicated checkout directory and its cache must stay under node_modules.');
  }
  const results = path.join(root, 'test-results');
  return { output, base: config.base.endsWith('/') ? config.base : config.base + '/',
    excludeTestResults: ![source, publicDir].some(value => inside(results, value)), user };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await configuration(path.resolve(process.argv[2]), process.argv[3]?.split(',').filter(Boolean),
                        process.argv[4], process.argv[5] === 'applied');
    console.log('WEB_APP_ASTRO_CONFIGURATION_READY');
  } catch (error) {
    console.error('WEB_APP_FOUNDATION_CONFIGURATION_FAILED: ' + error.message
      + ' Preserve source and locks; correct the Astro static configuration or restore dependencies, then Review/Apply Settings.');
    process.exitCode = 1;
  }
}

async function availablePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  if (address.address !== '127.0.0.1') throw new Error('Port reservation did not bind to loopback.');
  return address.port;
}

export async function development(root, signal) {
  signal?.throwIfAborted();
  const { user, base } = await configuration(root);
  const port = await availablePort();
  const { dev } = await localAstro(root);
  signal?.throwIfAborted();
  const server = await dev({ ...user, root, configFile: false,
    server: { host: '127.0.0.1', port, open: false },
    vite: { ...user.vite, server: { ...user.vite?.server, host: '127.0.0.1', port, strictPort: true } } });
  let closing;
  const close = () => closing ||= server.stop();
  const cancel = () => { void close().catch(error => console.error('WEB_APP_SERVER_CLEANUP_FAILED: ' + error.message)); };
  signal?.addEventListener('abort', cancel, { once: true });
  const address = server.address;
  if (signal?.aborted || address.address !== '127.0.0.1' || address.family !== 'IPv4' || address.port !== port) {
    signal?.removeEventListener('abort', cancel);
    await close();
    signal?.throwIfAborted();
    throw new Error('Astro did not bind the exact owned IPv4 loopback port.');
  }
  return { address, url: 'http://127.0.0.1:' + port, base,
    close: async () => { signal?.removeEventListener('abort', cancel); await close(); } };
}
