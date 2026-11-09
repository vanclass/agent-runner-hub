import net from 'node:net';
import { remote } from 'webdriverio';
import { commandMs } from './limits.mjs';

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  return port;
}
// Caller must bind the listener to its owned process before connecting.
export function connectDriver(port) {
  return remote({ hostname: '127.0.0.1', port, path: '/', logLevel: 'silent',
    connectionRetryCount: 0, connectionRetryTimeout: commandMs, waitforTimeout: commandMs,
    capabilities: { browserName: 'tauri' } });
}