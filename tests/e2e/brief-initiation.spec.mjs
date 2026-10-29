import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('Brief initiation deadline retains pending evidence and prevents replay', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(async () => {
    const { RunnerBrief } = await import('/src/hub/RunnerBrief.ts');
    const { RunFixture } = await import('/tests/fixtures/run.ts');
    const { controlTiming } = await import('/src/hub/runnerControl.ts');
    const features = { generation: 42, brief: { version: 1, operations: ['brief.stage'] }, results: [] };
    const fixture = new RunFixture(features, 'pending');
    const snapshot = { state: 'ready', features, results: [], observation: { run_mode: 'issue-run' } };
    const brief = new RunnerBrief({ identity: () => ({ session: 'original', generation: features.generation }),
      available: () => true, completionMs: controlTiming.completionMs, pollMs: controlTiming.pollMs,
      stage: async (session, body) => {
        features.results.push({ id: 7000, feature: 'brief', operation: 'brief.stage', state: 'accepted', phase: 'completed',
          reply: { staging_status: 'staged', owner: 'brief_staging', count: 1, outcome_unknown: false } });
        return { state: 'submitted', id: 7000, generation: 42 };
      }, run: (session, request) => { if (session !== 'original') throw Error('retargeted'); return fixture.submit(request); },
    }, () => {});
    brief.observe(snapshot); window.__brief = { brief, fixture, snapshot };
    window.__brief.promise = brief.submit('retained body');
  });
  await expect.poll(() => page.evaluate(() => window.__brief.fixture.requests.length)).toBeGreaterThan(1);
  await page.clock.runFor(66000);
  const result = await page.evaluate(async () => {
    const { brief, fixture, promise } = window.__brief;
    const result = await promise; await brief.submit('must not replay');
    return { result, blocked: brief.blocked, requests: fixture.requests };
  });
  expect(result.result).toMatchObject({ staged: true, status: 'unknown', outcome: 'pending',
    initiation: { initiation_status: 'pending' } });
  expect(result.blocked).toBe(true);
  expect(result.requests.filter(r => r.operation === 'run.invoke')).toHaveLength(1);
});

for (const fault of ['disconnected', 'generation', 'capability', 'lost-completion']) {
  test(`Brief initiation ${fault} preserves uncertainty without replay`, async ({ page }) => {
    await page.clock.install();
    // Reuse the production owner and the shared wire fixture; no Hub orchestration is reproduced here.
    await page.evaluate(async fault => {
      const { RunnerBrief } = await import('/src/hub/RunnerBrief.ts');
      const { RunFixture } = await import('/tests/fixtures/run.ts');
      const features = { generation: 1, brief: { version: 1, operations: ['brief.stage'] }, results: [] };
      const fixture = new RunFixture(features, 'pending');
      const snapshot = { state: 'ready', features, results: [], observation: { run_mode: 'issue-run' } };
      const brief = new RunnerBrief({ identity: () => ({ session: 'original', generation: features.generation }),
        available: () => true, completionMs: 65000, pollMs: 500,
        stage: async () => {
          features.results.push({ id: 7, feature: 'brief', operation: 'brief.stage', state: 'accepted', phase: 'completed',
            reply: { staging_status: 'staged', owner: 'brief_staging', count: 1, outcome_unknown: false } });
          return { state: 'submitted', id: 7, generation: 1 };
        }, run: async (session, request) => {
          const admission = await fixture.submit(request);
          if (request.operation === 'run.status') {
            if (fault === 'disconnected') snapshot.state = 'disconnected';
            if (fault === 'generation') features.generation++;
            if (fault === 'capability') features.run = null;
            if (fault === 'lost-completion') features.results.at(-1).state = 'queued';
          }
          return admission;
        },
      }, () => {});
      brief.observe(snapshot); window.__brief = { brief, fixture, promise: brief.submit('original') };
    }, fault);
    await page.clock.runFor(66000);
    const result = await page.evaluate(async () => {
      const { brief, fixture, promise } = window.__brief; const result = await promise;
      await brief.submit('duplicate'); return { result, blocked: brief.blocked, requests: fixture.requests };
    });
    expect(result.result.status).toBe('unknown'); expect(result.blocked).toBe(true);
    expect(result.requests.filter(r => r.operation === 'run.invoke')).toHaveLength(1);
  });
}
