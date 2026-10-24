import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function startDevServer(root, port, signal) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a development port from 1 to 65535.');
  signal.throwIfAborted();
  const require = createRequire(path.join(root, 'package.json'));
  const entry = require.resolve('vite');
  const vite = await fs.realpath(path.join(root, 'node_modules/vite'));
  if (!entry.startsWith(vite + path.sep)) throw new Error('Vite must come from the selected project checkout.');
  const { createServer } = await import(pathToFileURL(entry).href);
  const identity = randomUUID();
  const readinessPath = '/__runner_tauri_ready/' + identity;
  const server = await createServer({ root, clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true, open: false, middlewareMode: false,
      watch: { ignored: ['**/src-tauri/**', '**/.runner/web-app-tauri/cache/**'] },
      hmr: { host: '127.0.0.1', port, clientPort: port } },
    plugins: [{ name: 'runner-tauri-owned-readiness', configureServer(instance) {
      instance.middlewares.use((request, response, next) => {
        if (request.url !== readinessPath) return next();
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ identity, root }));
      });
    } }] });
  let closed = false;
  async function close() {
    if (!closed) { closed = true; await server.close(); }
  }
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || address.address !== '127.0.0.1' || address.port !== port) {
      throw new Error('The owned Vite listener did not bind to the selected loopback port.');
    }
    const origin = 'http://127.0.0.1:' + port;
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
