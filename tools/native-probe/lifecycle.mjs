import assert from 'node:assert/strict';
import { defineNativeCase, outcome } from './case.mjs';
import { until, noActivation, displayed } from './observations.mjs';

// One invocation, one case, one process/profile and one driver session.
// Resource owners implement settlement; this pipeline orders those boundaries.
export async function executeCase(spec, environment, resources) {
  const testCase = defineNativeCase(spec);
  const focusRequired = testCase.presentation === 'focus-required';
  if (focusRequired && environment.platform !== 'win32') {
    throw new TypeError('Focus-required native cases support Windows only');
  }
  const evidence = { schemaVersion: 2, caseId: testCase.id, environment,
    startedAt: new Date().toISOString(), stage: 'prerequisites', stages: {},
    focusRequired: focusRequired ? 'input requires existing Computer Use ownership' : 'not requested' };
  let owner, browser, failure;
  try {
    owner = await resources.start();
    evidence.pid = owner.pid;
    evidence.stages.initial = await until(async () => {
      const state = await owner.request('snapshot');
      return state.hwnd && (owner.initialPresentation !== 'nonactivating' || state.visible) ? state : null;
    }, resources.signal);
    evidence.initialPresentation = owner.initialPresentation ?? 'background';
    if (evidence.initialPresentation === 'nonactivating') {
      assert.equal(testCase.presentation, 'nonactivating', 'Background evidence cannot be downgraded');
      displayed(evidence.stages.initial, evidence.stages.initial);
    } else {
      assert.equal(evidence.initialPresentation, 'background');
      assert.equal(evidence.stages.initial.visible, false);
    }
    noActivation(evidence.stages.initial);
    evidence.listener = await until(async () => {
      const state = await owner.request('listener');
      return state.listeners.length ? state : null;
    }, resources.signal);
    browser = await resources.connect();
    evidence.stages.connected = await owner.request('snapshot');
    noActivation(evidence.stages.connected);
    evidence.stage = 'readiness';
    await testCase.ready(browser);
    resources.signal.throwIfAborted();
    if (focusRequired) {
      evidence.stage = 'presentation';
      evidence.stages.placed = await owner.request('show');
      displayed(evidence.stages.initial, evidence.stages.placed);
    }
    evidence.stage = 'assertions';
    evidence.observations = await testCase.run(browser, focusRequired
      ? Object.freeze({ pid: owner.pid, hwnd: evidence.stages.initial.hwnd }) : undefined);
    if (testCase.afterRestart) {
      await browser.deleteSession(); browser = undefined;
      evidence.firstTeardown = await owner.stop();
      noActivation(evidence.firstTeardown);
      assert.equal(evidence.firstTeardown.stopped, true);
      assert.equal(evidence.firstTeardown.forced, false);
      assert.equal(evidence.firstTeardown.exitCode, 0);
      owner = await resources.start();
      evidence.restartPid = owner.pid;
      evidence.stages.firstInitial = evidence.stages.initial;
      evidence.stages.initial = await until(async () => {
        const state = await owner.request('snapshot');
        return state.hwnd ? state : null;
      }, resources.signal);
      noActivation(evidence.stages.initial);
      await until(async () => (await owner.request('listener')).listeners.length, resources.signal);
      browser = await resources.connect();
      noActivation(await owner.request('snapshot'));
      await testCase.ready(browser);
      evidence.restartObservations = await testCase.afterRestart(browser, evidence.observations);
    }
    evidence.stages.afterActions = await owner.request('snapshot');
    if (focusRequired) {
      assert.equal(evidence.stages.afterActions.pid, owner.pid);
      assert.equal(evidence.stages.afterActions.hwnd, evidence.stages.initial.hwnd, 'Owned input window changed');
    } else noActivation(evidence.stages.afterActions);
    resources.signal.throwIfAborted();
    if (testCase.presentation === 'nonactivating') {
      evidence.stage = 'presentation';
      evidence.stages.placed = await owner.request('show');
      displayed(evidence.stages.initial, evidence.stages.placed);
      evidence.stage = 'displayed-assertions';
      evidence.displayedObservations = await testCase.observe(browser);
      await resources.capture(browser);
      evidence.stages.observed = await owner.request('snapshot');
      noActivation(evidence.stages.observed);
    }
    evidence.stage = 'completed';
  } catch (error) {
    failure = error;
    evidence.failure = { stage: evidence.stage, name: error.name, message: error.message };
  } finally {
    const cleanupErrors = [];
    let mayTeardown = true;
    if (focusRequired && browser) {
      try { evidence.settlement = await testCase.settle(browser); }
      catch (error) {
        mayTeardown = false;
        cleanupErrors.push({ stage: 'case-settlement', message: error.message });
      }
    }
    if (browser && mayTeardown) {
      try { await browser.deleteSession(); }
      catch (error) { cleanupErrors.push({ stage: 'driver', message: error.message }); }
    }
    if (owner && mayTeardown) {
      try {
        evidence.teardown = await owner.stop();
        if (!focusRequired) noActivation(evidence.teardown);
        assert.equal(evidence.teardown.forced, false);
        assert.equal(evidence.teardown.exitCode, 0);
        assert.equal(evidence.teardown.listenerReleased, true);
      } catch (error) { cleanupErrors.push({ stage: 'native', message: error.message }); }
    }
    try {
      assert.ok(!owner || evidence.teardown?.stopped, 'Owned settlement required before profile removal');
      await resources.release();
      evidence.resourcesReleased = true;
    } catch (error) { cleanupErrors.push({ stage: 'profile', message: error.message }); }
    evidence.outcome = cleanupErrors.length ? 'failed' : outcome(failure);
    if (cleanupErrors.length) evidence.cleanupErrors = cleanupErrors;
    await resources.record(evidence);
  }
  return evidence;
}
