import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCase } from '../../tools/native-probe/lifecycle.mjs';
import { defineNativeCase, BlockedPrerequisite, UnverifiedObservation } from '../../tools/native-probe/case.mjs';
import { platformAdapter } from '../../tools/native-probe/owner.mjs';

function fixture(overrides = {}) {
  const calls = [], records = [];
  const hidden = { hwnd: 42, visible: false, activationObserved: false };
  const shown = { ...hidden, visible: true, foregroundAbove: true };
  let visible = false;
  const browser = { async deleteSession() { calls.push('deleteSession'); } };
  const owner = { pid: 123,
    async request(action) {
      calls.push(action);
      if (action === 'show') { visible = true; return shown; }
      if (action === 'listener') return { ...hidden, listeners: [{ address: '127.0.0.1', port: 1234 }] };
      return visible ? shown : hidden;
    },
    async stop() {
      calls.push('stop');
      return { stopped: true, forced: false, exitCode: 0, listenerReleased: true, activationObserved: false };
    }
  };
  return { calls, records, owner, browser, resources: {
    signal: new AbortController().signal,
    async start() { calls.push('start'); return owner; },
    async connect() { calls.push('connect'); return browser; },
    async capture() { calls.push('capture'); },
    async release() { calls.push('release'); },
    async record(evidence) { calls.push('record'); records.push(evidence); },
    ...overrides
  } };
}
function spec(id, calls, presentation = 'background') {
  return defineNativeCase({ id, presentation,
    async ready() { calls.push(id + ':ready'); },
    async run() { calls.push(id + ':run'); return { assertion: id }; },
    async observe() { calls.push(id + ':observe'); return { displayed: id }; }
  });
}
test('independent cases compose through the same lifecycle with no feature dispatch', async () => {
  for (const id of ['first-feature', 'second-feature']) {
    const f = fixture();
    const result = await executeCase(spec(id, f.calls, 'nonactivating'), { platform: 'fixture' }, f.resources);
    assert.equal(result.caseId, id);
    assert.equal(result.outcome, 'passed');
    assert.deepEqual(result.observations, { assertion: id });
    assert.deepEqual(f.calls, ['start', 'snapshot', 'listener', 'connect', 'snapshot', id + ':ready', id + ':run',
      'snapshot', 'show', id + ':observe', 'capture', 'snapshot', 'deleteSession', 'stop', 'release', 'record']);
  }
});
test('restart keeps profile resources until both independently owned processes settle', async () => {
  const f = fixture();
  const first = spec('restart', f.calls);
  const result = await executeCase({ ...first, async afterRestart(browser, prior) {
    assert.equal(browser, f.browser);
    assert.deepEqual(prior, { assertion: 'restart' });
    assert.equal(f.calls.filter(call => call === 'start').length, 2);
    assert.equal(f.calls.filter(call => call === 'stop').length, 1);
    assert.ok(!f.calls.includes('release'));
    return { restored: true };
  } }, {}, f.resources);
  assert.equal(result.outcome, 'passed');
  assert.deepEqual(result.restartObservations, { restored: true });
  assert.equal(f.calls.filter(call => call === 'stop').length, 2);
  assert.equal(f.calls.filter(call => call === 'release').length, 1);
});

test('background mode never shows a native window', async () => {
  const f = fixture();
  const result = await executeCase(spec('background', f.calls), {}, f.resources);
  assert.equal(result.outcome, 'passed');
  assert.ok(!f.calls.includes('show'));
  assert.ok(!f.calls.includes('capture'));
});

test('explicit startup presentation is verified and cannot satisfy a hidden case', async () => {
  for (const presentation of ['background', 'nonactivating']) {
    const f = fixture();
    f.owner.initialPresentation = 'nonactivating';
    const original = f.owner.request;
    f.owner.request = async action => action === 'snapshot'
      ? { hwnd: 42, visible: true, foregroundAbove: true, activationObserved: false } : original(action);
    const result = await executeCase(spec('startup', f.calls, presentation), {}, f.resources);
    assert.equal(result.outcome, presentation === 'background' ? 'failed' : 'passed');
    assert.equal(result.initialPresentation, 'nonactivating');
  }
});
test('readiness failure settles driver and process before profile removal', async () => {
  const f = fixture();
  const result = await executeCase({ ...spec('bad-ready', f.calls), ready() { throw new Error('not ready'); } }, {}, f.resources);
  assert.equal(result.failure.stage, 'readiness');
  assert.equal(result.outcome, 'failed');
  assert.ok(!f.calls.includes('bad-ready:run'));
  assert.deepEqual(f.calls.slice(-4), ['deleteSession', 'stop', 'release', 'record']);
});
test('prerequisite and unverified observations remain distinguishable in final evidence', async () => {
  for (const [error, status] of [[new BlockedPrerequisite('Missing native capability'), 'blocked'],
    [new UnverifiedObservation('Cannot establish placement'), 'unverified']]) {
    const f = fixture();
    f.owner.request = async action => {
      if (action === 'show') throw error;
      return action === 'listener' ? { listeners: [{}] } : { hwnd: 1, visible: false, activationObserved: false };
    };
    const result = await executeCase(spec(status, f.calls, 'nonactivating'), { platform: 'fixture' }, f.resources);
    assert.equal(result.outcome, status);
    assert.equal(result.failure.stage, 'presentation');
    assert.equal(result.failure.message, error.message);
    assert.ok(!f.calls.includes(status + ':observe'));
    assert.ok(f.calls.includes('stop'));
  }
});
test('cleanup failure overrides a successful assertion and prevents unsafe profile removal', async () => {
  const f = fixture();
  f.owner.stop = async () => { throw new Error('still owned'); };
  const result = await executeCase(spec('cleanup', f.calls), {}, f.resources);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.cleanupErrors[0].stage, 'native');
  assert.equal(result.cleanupErrors[1].stage, 'profile');
  assert.ok(!f.calls.includes('release'));
});
test('driver deletion failure still settles owned process', async () => {
  const f = fixture();
  f.browser.deleteSession = async () => { throw new Error('session lost'); };
  const result = await executeCase(spec('session', f.calls), {}, f.resources);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.cleanupErrors[0].stage, 'driver');
  assert.ok(f.calls.includes('stop'));
  assert.ok(f.calls.includes('release'));
});
test('nonactivating evidence cannot silently downgrade to a visible foreground window', async () => {
  const f = fixture();
  const original = f.owner.request;
  f.owner.request = async action => action === 'show'
    ? { hwnd: 42, visible: true, foregroundAbove: false, activationObserved: false } : original(action);
  const result = await executeCase(spec('placement', f.calls, 'nonactivating'), {}, f.resources);
  assert.equal(result.outcome, 'failed');
  assert.ok(!f.calls.includes('placement:observe'));
});
test('case interface rejects focus-required and missing readiness', () => {
  assert.throws(() => defineNativeCase({ id: 'unsafe', presentation: 'focus-required' }), /Computer Use/);
  assert.throws(() => defineNativeCase({ id: 'missing', presentation: 'background' }), /ready/);
  assert.throws(() => defineNativeCase({ id: '../bad', presentation: 'background' }), /path-safe/);
});
test('platform dispatch rejects unsupported hosts without adopting another adapter', () => {
  assert.throws(() => platformAdapter('linux'), BlockedPrerequisite);
  assert.equal(typeof platformAdapter('win32').startOwner, 'function');
});
