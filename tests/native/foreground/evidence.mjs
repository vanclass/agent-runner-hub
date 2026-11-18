import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { frontendSource } from './source.mjs';
import { hash } from './bootstrap.mjs';

export function verifyForegroundPair(source, reports) {
  assert.deepEqual(reports.map(report => report.mode), ['plain', 'synthetic'], 'Both smoke modes required');
  for (const report of reports) {
    assert.equal(report.outcome, 'passed', 'Smoke setup did not pass');
    assert.equal(report.build.sourceVerifiedAfterBuild, true);
    assert.deepEqual(report.build.source.inputs, source.inputs, 'Smoke frontend inputs differ from admitted checkout');
    assert.equal(report.build.source.sha256, source.sha256, 'Smoke source inventory digest mismatch');
    assert.equal(report.build.sourceHead, report.build.source.expectedHead);
    assert.equal(report.input, 'none');
    assert.equal(report.productAcceptance, 'unverified');
    assert.equal(report.readiness.actual, report.mode + '-ready');
    assert.ok(report.profileRemoved && report.settlement.stopped && report.settlement.childrenSettled,
      'Owned process/profile settlement required');
    assert.equal(report.settlement.forced, false);
    assert.equal(report.settlement.exitCode, 0);
  }
  return { expectedHead: source.expectedHead, sourceSha256: source.sha256, modes: reports.map(report => report.mode) };
}

export async function verifyForegroundFiles(root, expectedHead, folder, signal) {
  const source = await frontendSource(root, expectedHead, signal);
  const files = await Promise.all(['plain', 'synthetic'].map(async mode => {
    const file = path.join(folder, mode + '.json'), bytes = await fs.readFile(file);
    return { path: file, sha256: hash(bytes), report: JSON.parse(bytes) };
  }));
  return { ...verifyForegroundPair(source, files.map(file => file.report)),
    evidence: files.map(({ path, sha256 }) => ({ path, sha256 })) };
}
