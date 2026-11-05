import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';

export async function startDevServer(root, port, signal) {
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Choose a development port from 1 to 65535.');
  signal.throwIfAborted();
  const require = createRequire(path.join(root, 'package.json'));
  const entry = require.resolve('vite');
  const vite = await fs.realpath(path.join(root, 'node_modules/vite'));
  if (!entry.startsWith(vite + path.sep)) throw new Error('Vite must come from the selected project checkout.');
  const { createServer } = await import(pathToFileURL(entry).href);
  const identity = randomUUID();
  const readinessPath = '/__runner_native_ready/' + identity;
  const listener = createHttpServer();
  let server;
  const plugin = { name: 'runner-native-owned-readiness', enforce: 'post',
    config: { order: 'post', handler(config) {
      const hmr = { ...config.server?.hmr, host: '127.0.0.1', server: listener };
      for (const key of ['port', 'clientPort', 'protocol']) delete hmr[key];
      config.server = { ...config.server, host: '127.0.0.1', port: port ?? 0,
        strictPort: true, open: false, middlewareMode: true, https: false, hmr };
    } },
    configureServer(instance) {
      instance.middlewares.use((request, response, next) => {
        if (request.url !== readinessPath) return next();
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ identity, root }));
      });
    } };
  let closed = false;
  async function close() {
    if (!closed) {
      closed = true;
      await server?.close();
      if (listener.listening) {
        const closing = new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
        listener.closeAllConnections();
        await closing;
      }
    }
  }
  try {
    server = await createServer({ root, clearScreen: false,
      server: { watch: { ignored: ['**/src-tauri/**', '**/.runner/**', '**/tools/web_app_build_system/**'] } },
      plugins: [plugin] });
    const network = server.config.server;
    if (!network.middlewareMode || network.host !== '127.0.0.1' || network.https
        || network.hmr?.server !== listener || network.hmr.port || network.hmr.clientPort || network.hmr.protocol) {
      throw new Error('Vite configuration replaced the owned loopback/HMR listener.');
    }
    listener.on('request', server.middlewares);
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(port ?? 0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (!address || address.address !== '127.0.0.1' || (port !== undefined && address.port !== port)) {
      throw new Error('The owned Vite listener did not bind to the selected loopback port.');
    }
    const origin = 'http://127.0.0.1:' + address.port;
    const probe = await fetch(origin + readinessPath, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    const observed = await probe.json();
    if (!probe.ok || observed.identity !== identity || observed.root !== root) {
      throw new Error('Vite readiness did not establish the owned checkout identity.');
    }
    signal.throwIfAborted();
    return { origin, close, address };
  } catch (error) {
    await close();
    if (error.code === 'EADDRINUSE' || /already in use/.test(error.message)) {
      throw new Error('Development port ' + port + ' is occupied. Stop its owner or choose another --port; no existing server was adopted.');
    }
    throw error;
  }
}
