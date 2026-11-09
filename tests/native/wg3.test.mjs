import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { outcome, BlockedPrerequisite, UnverifiedObservation } from '../../tools/native-probe/case.mjs';
import { readyInstalledHub, finalReceipt, testSelection, inspectRequest } from './webdriver/runner-flow.mjs';

const connection = { session: 'owned-session', generation: 7,
  snapshot: { state: 'ready', features: { generation: 7, results: [], runnerRoot: 'C:/isolated' } } };
const admission = { state: 'submitted', generation: 7, id: 42 };
const completed = { id: 42, feature: 'session_config', operation: 'session_config.inspect', phase: 'completed', state: 'accepted' };
const snapshot = results => ({ state: 'ready', features: { generation: 7, results } });

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

test('absent isolated installation and unsupported macOS launch block before browser effects', async () => {
  const browser = new Proxy({}, { get() { throw new Error('Browser must remain untouched'); } });
  await assert.rejects(readyInstalledHub(browser), BlockedPrerequisite);
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

test('Test selection rejection is a blocked prerequisite; native failure and malformed acceptance fail', async () => {
  for (const [result, expected] of [
    [{ ...completed, state: 'rejected', code: 'TEST_AUTH_UNAVAILABLE' }, 'blocked'],
    [{ ...completed, state: 'failure' }, 'failed'],
    [{ ...completed, reply: { authentication: 'available' } }, 'failed']
  ]) {
    const fixture = transport(result);
    const error = await testSelection(fixture.browser, connection, 'C:/isolated').then(() => null, error => error);
    assert.equal(outcome(error), expected);
    assert.deepEqual(fixture.calls, ['session_config.inspect', 'runner_observe']);
  }
});

test('real-shaped fixture response still needs the exact installation; fixture success is not native acceptance', async () => {
  const reply = { api_version: 1, execution_context: 'test', authentication: 'available',
    account: { agent_id: 'fixture', profile_name: 'Test' }, codex_home: 'C:/isolated/test', runner_root: 'C:/isolated' };
  const fixture = transport({ ...completed, reply });
  assert.equal((await testSelection(fixture.browser, connection, 'C:/isolated')).result.reply, reply);
  await assert.rejects(testSelection(transport({ ...completed, reply }).browser, connection, 'C:/other'), /selected installation/);
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
  for (const args of [['--help'], ['--case', 'unknown'], ['--isolated-runner-root', 'relative']]) {
    const child = spawnSync(process.execPath, ['tools/native-probe/hub.mjs', ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, args[0] === '--help' ? 0 : 1);
    assert.doesNotMatch(child.stdout, /native probe|Native evidence/);
  }
});
