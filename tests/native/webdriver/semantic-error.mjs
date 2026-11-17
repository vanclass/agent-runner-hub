import assert from 'node:assert/strict';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, correlated } from './runner-flow.mjs';

export async function semanticError(browser, connection) {
  // The installed /files parser accepts only the exact command. Extra arguments
  // take its read-only rejection path, without opening the foreground file flow.
  const command = '/files __hub_invalid_argument__';
  await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-composer textarea')?.disabled), { timeout: startupMs });
  await changeValue(browser, '.runner-composer textarea', command);
  await browser.execute(() => {
    const input = document.querySelector('.runner-composer textarea');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  let receipt;
  await browser.waitUntil(async () => {
    const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
    receipt = snapshot.results.find(r => r.command === command && r.phase === 'completed');
    return !!receipt;
  }, { timeout: startupMs, timeoutMsg: 'Read-only invalid command receipt unverified; do not replay' });
  await browser.waitUntil(async () => browser.execute(command => [...document.querySelectorAll('.xterm-rows > div')]
    .some(line => !line.textContent.includes(command)
      && /error|invalid|usage|does not|cannot|오류|잘못|인자/i.test(line.textContent)), command),
  { timeout: startupMs, timeoutMsg: 'Actual Runner rejection did not reach PTY viewport' });
  assert.notEqual(receipt.state, 'outcome-unknown');
  return { state: receipt.state, ownerStatus: receipt.ownerStatus, code: receipt.code, ptyOutputObserved: true };
}
