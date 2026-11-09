import assert from 'node:assert/strict';
import { BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyHub } from './probe.mjs';
import { isTestSelection, isInspection, sameInstallation } from './config-contract.mjs';

export async function changeValue(browser, selector, value) {
  await browser.execute((selector, value) => {
    const element = document.querySelector(selector);
    if (!element || element.disabled) throw new Error('Control unavailable: ' + selector);
    Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, selector, value);
}

// Observe existing application IPC without replacing responses, credentials or transport.
// Retain only observation IDs/snapshots, never PTY bytes or authentication material.
export async function watchObservations(browser) {
  await browser.execute(() => {
    const bridge = window.__TAURI_INTERNALS__, original = bridge.invoke;
    const watch = { snapshots: {}, restore: () => { bridge.invoke = original; } };
    bridge.invoke = async function(command, args, ...rest) {
      const result = await original.call(this, command, args, ...rest);
      if (command === 'runner_observe') watch.snapshots[args.id] = result;
      return result;
    };
    window.__wg3Observation = watch;
  });
}
export async function stopWatching(browser) {
  await browser.execute(() => { window.__wg3Observation?.restore(); delete window.__wg3Observation; });
}

export async function readyInstalledHub(browser, runnerRoot, platform = process.platform) {
  if (!runnerRoot) throw new BlockedPrerequisite(
    'Select --isolated-runner-root with a dedicated installed Runner and saved /account > Test account settings; no user session is adopted.');
  if (platform !== 'win32') throw new BlockedPrerequisite(
    'Runner launch is unsupported on macOS by the existing native containment owner; native integration is unverified.');
  await readyHub(browser);
  await watchObservations(browser);
  await changeValue(browser, '.runner-location input', runnerRoot);
  await browser.execute(() => document.querySelector('.runner-location').requestSubmit());
  await browser.waitUntil(async () => browser.execute(() =>
    !document.querySelector('.app-settings[open]') || !!document.querySelector('.runner-location [role="alert"]')),
  { timeout: startupMs, timeoutMsg: 'Installation UI did not settle' });
  const error = await browser.execute(() => document.querySelector('.runner-location [role="alert"]')?.textContent);
  if (error) throw new BlockedPrerequisite('Installed Runner verification: ' + error);
  const saved = await browser.execute(() => localStorage.getItem('agent-runner-hub.installation'));
  assert.ok(sameInstallation(saved, runnerRoot), 'UI must persist the verified explicit installation');
  await browser.execute(() => {
    const toggle = document.querySelector('.task-panel-toggle');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
  });
}

export async function ownedConnection(browser) {
  let connection;
  await browser.waitUntil(async () => {
    connection = await browser.execute(() => {
      const entries = Object.entries(window.__wg3Observation.snapshots);
      return entries.length === 1 ? { session: entries[0][0], snapshot: entries[0][1] } : null;
    });
    return connection && connection.snapshot.state !== 'connecting';
  }, { timeout: startupMs, timeoutMsg: 'Owned Hub Runner observation did not settle' });
  if (connection.snapshot.state !== 'ready') throw new BlockedPrerequisite(
    'Owned Runner did not authenticate; configure the dedicated installation and saved Test account.');
  const { snapshot } = connection;
  assert.ok(snapshot.observationSerial > 0);
  assert.ok(snapshot.observationAgeMs >= 0);
  assert.ok(snapshot.features?.generation > 0);
  if (!snapshot.features.sessionConfig?.test_account_selection) throw new BlockedPrerequisite(
    'Unsupported capability: Runner must advertise Session Config Test account selection.');
  return { ...connection, generation: snapshot.features.generation };
}

export function correlated(snapshot, connection) {
  if (snapshot.state !== 'ready' || snapshot.features?.generation !== connection.generation)
    throw new UnverifiedObservation('Owned Runner session/generation changed; no replay.');
  return snapshot;
}
export function finalReceipt(snapshot, connection, admission) {
  correlated(snapshot, connection);
  if (admission.state !== 'submitted') {
    if (admission.state === 'not-sent') throw new Error('Read-only request not sent: ' + admission.detail);
    throw new UnverifiedObservation('Native transport effect unknown; do not replay.');
  }
  if (admission.generation !== connection.generation) throw new UnverifiedObservation('Stale submission generation');
  const result = snapshot.features.results.find(r => r.id === admission.id && r.feature === 'session_config'
    && r.operation === 'session_config.inspect' && r.phase === 'completed');
  if (result?.state === 'outcome-unknown') throw new UnverifiedObservation('Authoritative response unknown; do not replay.');
  return result;
}
export async function inspectRequest(browser, connection, request) {
  // Only the existing read-only operation is allowed at this acceptance boundary.
  assert.equal(request.operation, 'session_config.inspect');
  const admission = await browser.execute((id, request) => window.__TAURI_INTERNALS__.invoke(
    'runner_feature', { id, request: { feature: 'session_config', request } }), connection.session, request);
  // Classify provably unsent/uncertain transport before waiting for any response.
  finalReceipt(connection.snapshot, connection, admission);
  let result;
  await browser.waitUntil(async () => {
    const snapshot = await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session);
    result = finalReceipt(snapshot, connection, admission);
    return !!result;
  }, { timeout: startupMs, timeoutMsg: 'Read-only authoritative receipt unverified; do not resubmit' }).catch(error => {
    if (error instanceof assert.AssertionError || error instanceof UnverifiedObservation) throw error;
    throw new UnverifiedObservation(error.message);
  });
  return { admission, result };
}
export async function testSelection(browser, connection, runnerRoot) {
  const response = await inspectRequest(browser, connection,
    { operation: 'session_config.inspect', api_version: 1, execution_context: 'test' });
  const { result } = response;
  if (result.state === 'rejected') throw new BlockedPrerequisite(
    'Test account selection rejected: ' + result.code + '; configure /account > Test account settings in the isolated installation.');
  assert.equal(result.state, 'accepted', 'Native Test selection failed');
  assert.ok(isTestSelection(result.reply), 'Existing Test selection contract must validate');
  assert.ok(sameInstallation(result.reply.runner_root, runnerRoot), 'Test account must belong to the selected installation');
  assert.ok(sameInstallation(connection.snapshot.features.runnerRoot, runnerRoot));
  return response;
}
export async function inspection(browser, connection) {
  const response = await inspectRequest(browser, connection,
    { operation: 'session_config.inspect', api_version: 1, offset: 0 });
  assert.equal(response.result.state, 'accepted');
  assert.ok(isInspection(response.result.reply));
  return response;
}
export function receiptEvidence(response) {
  return { transport: response.admission, authoritative: { id: response.result.id,
    state: response.result.state, phase: response.result.phase, code: response.result.code ?? null } };
}
