import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyChromium } from './readiness.mjs';
import { development } from '../web-app-launch/astro.mjs';

export default async function setup() {
  const root = process.cwd();
  const id = process.env.RUNNER_WEB_APP_TEST_ID;
  const artifacts = process.env.RUNNER_WEB_APP_ARTIFACTS;
  const controller = new AbortController();
  mkdirSync(artifacts, { recursive: true });
  let starting;
  let server;
  let closing;
  const close = () => closing ||= (async () => {
    if (starting) server = await starting.catch(() => null);
    if (server) {
      await server.close();
      writeFileSync(path.join(artifacts, 'server-closed.json'), JSON.stringify({ id, pid: process.pid, closed: true }));
    }
  })();
  const interrupted = () => {
    controller.abort(new Error('Astro testing cancelled.'));
    void close().catch(error => console.error('WEB_APP_SERVER_CLEANUP_FAILED: ' + error.message));
  };
  const breakSignal = () => process.emit('SIGINT');
  const signals = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) process.once(signal, interrupted);
  if (process.platform === 'win32') process.once('SIGBREAK', breakSignal);
  const detach = () => {
    for (const signal of signals) process.removeListener(signal, interrupted);
    process.removeListener('SIGBREAK', breakSignal);
  };
  try {
    const browser = await verifyChromium();
    writeFileSync(path.join(artifacts, 'browser.json'), JSON.stringify(browser, null, 2));
    controller.signal.throwIfAborted();
    starting = development(root, controller.signal);
    server = await starting;
    controller.signal.throwIfAborted();
    const response = await fetch(server.url + '/', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const html = await response.text();
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html') || !/<html(?:\s|>)/i.test(html)) {
      throw new Error('The owned Astro checkout did not return valid HTML with HTTP 200.');
    }
    controller.signal.throwIfAborted();
    process.env.RUNNER_WEB_APP_URL = server.url;
    writeFileSync(path.join(artifacts, 'server.json'), JSON.stringify({ id, root, pid: process.pid,
      host: server.address.address, port: server.address.port, url: server.url, foundation: 'AstroTS' }, null, 2));
    console.log('WEB_APP_SERVER_READY ' + server.url + ' checkout=' + root);
    return async () => { detach(); await close(); };
  } catch (error) {
    try { await close(); } catch (cleanup) { console.error('WEB_APP_SERVER_CLEANUP_FAILED: ' + cleanup.message); }
    detach();
    const code = error.code?.startsWith('WEB_APP_') ? error.code : 'WEB_APP_SERVER_START_FAILED';
    const message = `${code}: ${error.message}. Check this checkout's Astro 6 static config and source; no existing server is reused.`;
    writeFileSync(path.join(artifacts, 'preflight-failure.json'), JSON.stringify({ code, message }));
    throw new Error(message, { cause: error });
  }
}
