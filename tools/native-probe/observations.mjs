import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startupMs, pollMs } from './limits.mjs';

export async function until(work, signal) {
  const deadline = Date.now() + startupMs;
  do {
    signal.throwIfAborted();
    const value = await work();
    if (value) return value;
    await delay(pollMs, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error('Native readiness timeout');
}
export function noActivation(state) {
  assert.equal(state.activationObserved, false, 'Test Hub acquired foreground activation');
}
export function displayed(before, after) {
  assert.equal(after.hwnd, before.hwnd, 'Owned main window changed');
  assert.equal(after.visible, true);
  assert.equal(after.foregroundAbove, true, 'Foreground window must be above the test window');
  noActivation(after);
}