import assert from 'node:assert/strict';
import { BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyHub } from './probe.mjs';
import { isInspection, sameInstallation } from './config-contract.mjs';

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
    if (Object.getOwnPropertyDescriptor(bridge, 'invoke')?.writable === false) {
      const callbacks = bridge.callbacks, set = callbacks.set;
      callbacks.set = function(id, callback) {
        return set.call(this, id, data => {
          const event = data?.message ?? data;
          if (['output', 'exit'].includes(event?.type) && typeof event.id === 'string') {
            if (event.type === 'output') watch.snapshots[event.id] ??= null;
            else delete watch.snapshots[event.id];
          }
          return callback(data);
        });
      };
      watch.restore = () => { callbacks.set = set; };
      window.__wg3Observation = watch;
      return;
    }
    bridge.invoke = async function(command, args, ...rest) {
      let result;
      try { result = await original.call(this, command, args, ...rest); }
      catch (error) {
        if (command === 'pty_open') watch.launchFailure = String(error);
        throw error;
      }
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
  if (platform !== 'win32') throw new BlockedPrerequisite(
    'Runner launch is unsupported on macOS by the existing native containment owner; native integration is unverified.');
  await readyHub(browser);
  runnerRoot ??= await browser.execute(() => localStorage.getItem('agent-runner-hub.installation'));
  if (!runnerRoot) throw new BlockedPrerequisite(
    'Select --runner-root with your existing installed Runner; the fresh Hub profile has no saved installation.');
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

export async function ownedConnection(browser, runnerRoot) {
  let connection;
  await browser.waitUntil(async () => {
    connection = await browser.execute(async () => {
      const entries = Object.entries(window.__wg3Observation.snapshots);
      if (entries.length !== 1) return null;
      const [session, observed] = entries[0];
      return { session, snapshot: observed ?? await window.__TAURI_INTERNALS__.invoke('runner_observe', { id: session }) };
    });
    return connection && connection.snapshot.state !== 'connecting';
  }, { timeout: startupMs, timeoutMsg: 'Owned Hub Runner observation did not settle' }).catch(async error => {
    const diagnostic = await browser.execute(() => ({
      launchFailure: window.__wg3Observation.launchFailure,
      sessions: Object.entries(window.__wg3Observation.snapshots).map(([id, state]) =>
        ({ id, state: state?.state, generation: state?.features?.generation })),
      status: [...document.querySelectorAll('[role="status"], [role="alert"]')].map(node => node.textContent)
    }));
    if (diagnostic.launchFailure) throw new BlockedPrerequisite('Owned Runner launch failed: ' + diagnostic.launchFailure);
    throw new UnverifiedObservation(error.message + ': ' + JSON.stringify(diagnostic));
  });
  if (connection.snapshot.state !== 'ready') throw new BlockedPrerequisite(
    'Owned Runner not ready: ' + connection.snapshot.state + '; ordinary startup account/authentication is required.');
  const { snapshot } = connection;
  assert.ok(snapshot.observationSerial > 0);
  assert.ok(snapshot.observationAgeMs >= 0);
  assert.ok(snapshot.features?.generation > 0);
  if (runnerRoot) assert.ok(sameInstallation(snapshot.features.runnerRoot, runnerRoot),
    'Owned session must use the selected installation');
  if (!snapshot.features.sessionConfig?.operations?.includes('session_config.inspect')) throw new BlockedPrerequisite(
    'Unsupported capability: ordinary session_config.inspect is required.');
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
export async function inspection(browser, connection) {
  const response = await inspectRequest(browser, connection,
    { operation: 'session_config.inspect', api_version: 1, offset: 0 });
  if (response.result.state === 'rejected') throw new BlockedPrerequisite(
    'Ordinary session_config.inspect rejected: ' + response.result.code);
  assert.equal(response.result.state, 'accepted');
  assert.ok(isInspection(response.result.reply));
  return response;
}
export function receiptEvidence(response) {
  return { transport: response.admission, authoritative: { id: response.result.id,
    state: response.result.state, phase: response.result.phase, code: response.result.code ?? null } };
}
