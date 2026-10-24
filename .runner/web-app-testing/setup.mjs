import { foundation, ASTRO } from '../web-app-launch/foundation.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { verifyChromium } from './readiness.mjs';

export default async function setup() {
  if (await foundation(process.cwd()) === ASTRO) return (await import('./astro.mjs')).default();
  const { createServer } = await import('vite');
  const root = process.cwd();
  const id = process.env.RUNNER_WEB_APP_TEST_ID;
  const artifacts = process.env.RUNNER_WEB_APP_ARTIFACTS;
  mkdirSync(artifacts, { recursive: true });
  let browser;
  try {
    browser = await verifyChromium();
  } catch (error) {
    writeFileSync(path.join(artifacts, 'preflight-failure.json'), JSON.stringify({ code: error.code, message: error.message }));
    throw error;
  }
  writeFileSync(path.join(artifacts, 'browser.json'), JSON.stringify(browser, null, 2));
  let server;
  let http;
  let closing;
  const close = () => closing ||= (async () => {
    let httpClosing;
    if (http?.listening) {
      httpClosing = new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
      http.closeAllConnections();
    }
    if (server) {
      await server.close();
      await httpClosing;
      if (http?.listening) throw new Error('WEB_APP_SERVER_CLEANUP_FAILED: owned listener is still open.');
      writeFileSync(path.join(artifacts, 'server-closed.json'), JSON.stringify({ id, pid: process.pid, closed: true }));
    }
  })();
  const interrupted = () => { void close().catch(error => console.error(`WEB_APP_SERVER_CLEANUP_FAILED: ${error.message}`)); };
  const breakSignal = () => process.emit('SIGINT');
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  if (process.platform === 'win32') process.once('SIGBREAK', breakSignal);
  try {
    http = createHttpServer((request, response) => server.middlewares(request, response));
    server = await createServer({
      root,
      clearScreen: false,
      cacheDir: path.join(root, 'node_modules/.vite-web-app-testing', id),
      server: { host: '127.0.0.1', middlewareMode: { server: http }, open: false,
                hmr: { server: http, host: '127.0.0.1', port: undefined, clientPort: undefined } },
      plugins: [{
        name: 'runner-web-app-test-identity',
        configureServer(instance) {
          instance.middlewares.use((request, response, next) => {
            if (request.url !== `/__runner_web_app_testing__/${id}`) return next();
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ id, root }));
          });
        },
      }],
    });
    await new Promise((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const address = http.address();
    if (!address || address.address !== '127.0.0.1' || !address.port) {
      throw new Error('The effective HTTP listener must use an OS-assigned IPv4 loopback port.');
    }
    const url = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${url}/__runner_web_app_testing__/${id}`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const identity = await response.json();
    if (!response.ok || identity.id !== id || identity.root !== root) throw new Error('Owned server identity/readiness mismatch.');
    process.env.RUNNER_WEB_APP_URL = url;
    writeFileSync(path.join(artifacts, 'server.json'), JSON.stringify({ id, root, pid: process.pid, host: address.address, port: address.port, url }, null, 2));
    console.log(`WEB_APP_SERVER_READY ${url} checkout=${root}`);
    return async () => {
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
      process.removeListener('SIGBREAK', breakSignal);
      await close();
    };
  } catch (error) {
    try { await close(); }
    catch (cleanup) { console.error(`WEB_APP_SERVER_CLEANUP_FAILED: ${cleanup.message}`); }
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    process.removeListener('SIGBREAK', breakSignal);
    const message = `WEB_APP_SERVER_START_FAILED: ${error.message}. Check this checkout's vite.config.ts and source; no existing server is reused.`;
    writeFileSync(path.join(artifacts, 'preflight-failure.json'), JSON.stringify({ code: 'WEB_APP_SERVER_START_FAILED', message }));
    throw new Error(message, { cause: error });
  }
}
