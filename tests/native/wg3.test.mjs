import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { outcome, BlockedPrerequisite, UnverifiedObservation } from '../../tools/native-probe/case.mjs';
import { readyInstalledHub, ownedConnection, finalReceipt, inspection, inspectRequest,
  watchObservations, stopWatching } from './webdriver/runner-flow.mjs';

const connection = { session: 'owned-session', generation: 7,
  snapshot: { state: 'ready', features: { generation: 7, results: [], runnerRoot: 'C:/isolated' } } };
const admission = { state: 'submitted', generation: 7, id: 42 };
const completed = { id: 42, feature: 'session_config', operation: 'session_config.inspect', phase: 'completed', state: 'accepted' };
const snapshot = results => ({ state: 'ready', features: { generation: 7, results } });

test('immutable native invoke identifies owned PTY events and forwards callbacks unchanged', async () => {
  const previous = globalThis.window, callbacks = new Map(), originalSet = callbacks.set;
  const bridge = { callbacks };
  Object.defineProperty(bridge, 'invoke', { value: async () => snapshot([]) });
  globalThis.window = { __TAURI_INTERNALS__: bridge };
  const browser = { execute: async fn => fn() };
  try {
    await watchObservations(browser);
    let received;
    callbacks.set(1, data => { received = data; });
    const event = { message: { type: 'output', id: 'owned-pty', bytes: [1, 2] }, index: 0 };
    callbacks.get(1)(event);
    assert.equal(received, event);
    assert.deepEqual(window.__wg3Observation.snapshots, { 'owned-pty': null });
    callbacks.get(1)({ message: { type: 'exit', id: 'owned-pty' } });
    assert.deepEqual(window.__wg3Observation.snapshots, {});
    await stopWatching(browser);
    assert.equal(callbacks.set, originalSet);
  } finally { globalThis.window = previous; }
});

test('queued transport is not authoritative response; unrelated receipts cannot satisfy the request', () => {
  assert.equal(finalReceipt(snapshot([{ ...completed, phase: 'queued' }]), connection, admission), undefined);
  for (const change of [{ id: 41 }, { feature: 'work' }, { operation: 'session_config.apply' }]) {
    assert.equal(finalReceipt(snapshot([{ ...completed, ...change }]), connection, admission), undefined);
  }
  assert.equal(finalReceipt(snapshot([completed]), connection, admission), completed);
});

test('stale generations and uncertain effects remain unverified, never accepted', () => {
  for (const [state, sent] of [
    [{ state: 'disconnected' }, admission],
    [{ state: 'ready', features: { generation: 8 } }, admission],
    [snapshot([completed]), { ...admission, generation: 8 }],
    [snapshot([]), { state: 'outcome-unknown' }],
    [snapshot([{ ...completed, state: 'outcome-unknown' }]), admission]
  ]) assert.throws(() => finalReceipt(state, connection, sent), UnverifiedObservation);
  assert.throws(() => finalReceipt(snapshot([]), connection, { state: 'not-sent', detail: 'closed' }), /not sent/);
});

test('unsupported macOS launch blocks before browser effects; fresh profile needs existing installation', async () => {
  const browser = new Proxy({}, { get() { throw new Error('Browser must remain untouched'); } });
  await assert.rejects(readyInstalledHub({ options: {}, waitUntil: async () => {}, execute: async () => null }), /--runner-root/);
  await assert.rejects(readyInstalledHub(browser, '/isolated', 'darwin'), /unsupported on macOS/);
});

function transport(result, sent = admission) {
  const calls = [];
  return { calls, browser: {
    async execute(_fn, id, request) {
      assert.equal(id, connection.session);
      calls.push(request ? request.operation : 'runner_observe');
      return request ? sent : snapshot([result]);
    },
    async waitUntil(predicate) { assert.ok(await predicate()); }
  } };
}

test('ordinary inspection rejection blocks; native failure and malformed acceptance fail', async () => {
  for (const [result, expected] of [
    [{ ...completed, state: 'rejected', code: 'AUTH_UNAVAILABLE' }, 'blocked'],
    [{ ...completed, state: 'failure' }, 'failed'],
    [{ ...completed, reply: { authentication: 'available' } }, 'failed']
  ]) {
    const fixture = transport(result);
    const error = await inspection(fixture.browser, connection).then(() => null, error => error);
    assert.equal(outcome(error), expected);
    assert.deepEqual(fixture.calls, ['session_config.inspect', 'runner_observe']);
  }
});

test('ordinary capability needs exact installation, without Test selection capability', async () => {
  const state = { ...snapshot([]), observationSerial: 1, observationAgeMs: 0 };
  state.features.runnerRoot = 'C:/regular';
  state.features.sessionConfig = { operations: ['session_config.inspect'] };
  const browser = { execute: async () => ({ session: 'owned-session', snapshot: state }),
    waitUntil: async predicate => assert.ok(await predicate()) };
  assert.equal((await ownedConnection(browser, 'C:/regular')).generation, 7);
  await assert.rejects(ownedConnection(browser, 'C:/other'), /selected installation/);
  state.features.sessionConfig.operations = [];
  await assert.rejects(ownedConnection(browser, 'C:/regular'), BlockedPrerequisite);
});

test('response timeout is unverified and submits only once; effectful operations are rejected before IPC', async () => {
  const fixture = transport(completed);
  fixture.browser.waitUntil = async () => { throw new Error('receipt timeout'); };
  await assert.rejects(inspectRequest(fixture.browser, connection,
    { operation: 'session_config.inspect', api_version: 1, offset: 0 }), UnverifiedObservation);
  assert.deepEqual(fixture.calls, ['session_config.inspect']);
  fixture.calls.length = 0;
  await assert.rejects(inspectRequest(fixture.browser, connection, { operation: 'work.submit' }));
  assert.deepEqual(fixture.calls, []);
  const unsent = transport(completed, { state: 'not-sent', detail: 'closed' });
  await assert.rejects(inspectRequest(unsent.browser, connection,
    { operation: 'session_config.inspect', api_version: 1, offset: 0 }), /not sent: closed/);
  assert.deepEqual(unsent.calls, ['session_config.inspect']);
});

test('documented CLI help and invalid selectors terminate without building or opening a window', () => {
  for (const args of [['--help'], ['--case', 'unknown'], ['--runner-root', 'relative'], ['--isolated-runner-root', 'C:/old']]) {
    const child = spawnSync(process.execPath, ['tools/native-probe/hub.mjs', ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, args[0] === '--help' ? 0 : 1);
    assert.doesNotMatch(child.stdout, /native probe|Native evidence/);
  }
});
