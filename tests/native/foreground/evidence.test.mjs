import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from './bootstrap.mjs';
import { verifyForegroundPair } from './evidence.mjs';

const inputs = { 'src/hub/shortcuts.ts': hash('current shortcuts'), 'src/hub/locales/en.json': hash('current locale') };
const source = { expectedHead: 'a'.repeat(40), inputs, sha256: hash(JSON.stringify(inputs)) };
function pair() {
  return ['plain', 'synthetic'].map(mode => ({ mode, outcome: 'passed', input: 'none', productAcceptance: 'unverified',
    build: { sourceVerifiedAfterBuild: true, sourceHead: source.expectedHead, source: structuredClone(source) },
    readiness: { actual: mode + '-ready' }, profileRemoved: true,
    settlement: { stopped: true, childrenSettled: true, forced: false, exitCode: 0 } }));
}

test('handoff compares effective frontend inputs, allowing a metadata-only successor commit', () => {
  const reports = pair();
  assert.equal(verifyForegroundPair({ ...source, expectedHead: 'b'.repeat(40) }, reports).sourceSha256, source.sha256);
  for (const name of Object.keys(inputs)) {
    const stale = pair();
    stale[1].build.source.inputs[name] = hash('earlier input');
    assert.throws(() => verifyForegroundPair(source, stale), /Smoke frontend inputs differ/);
  }
});

test('handoff rejects missing mode, setup failure, invalid inventory digest and unsettled profile', () => {
  assert.throws(() => verifyForegroundPair(source, pair().slice(0, 1)), /Both smoke modes/);
  for (const mutate of [
    report => { report.outcome = 'blocked'; },
    report => { report.build.source.sha256 = '0'.repeat(64); },
    report => { report.profileRemoved = false; },
    report => { report.settlement.childrenSettled = false; }
  ]) {
    const reports = pair(); mutate(reports[0]);
    assert.throws(() => verifyForegroundPair(source, reports));
  }
});
