import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnvironment } from './environment.mjs';
import { defineNativeCase } from './case.mjs';

// Explicit composition; node:test owns case reporting and filtering, no registry.
export function nativeSuite(cases, { root, target }) {
  const selected = cases.map(defineNativeCase);
  assert.equal(new Set(selected.map(c => c.id)).size, selected.length, 'Duplicate case id');
  test('native Hub environment', async t => {
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error('Native tests cancelled'));
    const signals = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
    for (const signal of signals) process.on(signal, cancel);
    let environment;
    try {
      environment = await createEnvironment(root, target, controller.signal);
      console.log('Native evidence: ' + environment.evidenceDir);
      for (const spec of selected) {
        await t.test(spec.id, async () => {
          const result = await environment.run(spec);
          assert.equal(result.outcome, 'passed', JSON.stringify(result.failure ?? result.cleanupErrors));
        });
      }
    } finally {
      try { await environment?.close(); }
      finally { for (const signal of signals) process.removeListener(signal, cancel); }
    }
  });
}