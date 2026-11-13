import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('Brief initiation Run-text-only deadline retains pending evidence and prevents replay', async ({ page }) => {
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
    window.__brief.promise = brief.submit('', undefined, '  retained Run 한글\n    🌍\t \n');
  });
  await expect.poll(() => page.evaluate(() => window.__brief.fixture.requests.length)).toBeGreaterThan(1);
  await page.clock.runFor(66000);
  const result = await page.evaluate(async () => {
    const { brief, fixture, promise } = window.__brief;
    const result = await promise; await brief.submit('must not replay');
    return { result, blocked: brief.blocked, requests: fixture.requests };
  });
  expect(result.result).toMatchObject({ staged: false, status: 'unknown', outcome: 'pending',
    initiation: { initiation_status: 'pending' } });
  expect(result.blocked).toBe(true);
  expect(result.requests.filter(r => r.operation === 'run.invoke')).toHaveLength(1);
  expect(result.requests.find(r => r.operation === 'run.invoke').text).toBe('  retained Run 한글\n    🌍\t \n');
  expect(result.result.stagingRequest).toBeUndefined();
});

for (const capability of ['invoke-only', 'status-only']) for (const body of ['', 'retained Brief']) {
  test(`Brief initiation ${capability} preflight with ${body ? 'Brief' : 'Run only'} has no effects`, async ({ page }) => {
    const observed = await page.evaluate(async ({ capability, body }) => {
      const { RunnerBrief } = await import('/src/hub/RunnerBrief.ts');
      const { RunFixture } = await import('/tests/fixtures/run.ts');
      const features = { generation: 1, brief: { version: 1, operations: ['brief.stage'] }, results: [] };
      const fixture = new RunFixture(features, capability);
      let staged = 0;
      const brief = new RunnerBrief({ identity: () => ({ session: 'original', generation: 1 }),
        available: () => true, completionMs: 65000, pollMs: 500,
        stage: async () => { staged++; throw Error('unexpected staging'); },
        run: (session, request) => fixture.submit(request) }, () => {});
      brief.observe({ state: 'ready', features, results: [], observation: { run_mode: 'issue-run' } });
      const result = await brief.submit(body, undefined, 'retained Run');
      const retry = await brief.submit(body, undefined, 'retained Run');
      return { result, retry, blocked: brief.blocked, busy: brief.busy, staged, requests: fixture.requests };
    }, { capability, body });
    expect(observed).toMatchObject({ result: { status: 'rejected', staged: false },
      retry: { status: 'rejected', staged: false }, blocked: false, busy: false, staged: 0, requests: [] });
    expect(observed.result.stagingRequest).toBeUndefined();
    expect(observed.result.runRequest).toBeUndefined();
  });
}

test('Brief receipt retains committed staging when Run status disappears before invocation', async ({ page }) => {
  const observed = await page.evaluate(async () => {
    const { RunnerBrief } = await import('/src/hub/RunnerBrief.ts');
    const { RunFixture } = await import('/tests/fixtures/run.ts');
    const features = { generation: 1, brief: { version: 1, operations: ['brief.stage'] }, results: [] };
    const fixture = new RunFixture(features);
    let staged = 0;
    const brief = new RunnerBrief({ identity: () => ({ session: 'original', generation: 1 }),
      available: () => true, completionMs: 65000, pollMs: 500,
      stage: async () => {
        staged++; features.run.operations = ['run.invoke'];
        features.results.push({ id: 7, feature: 'brief', operation: 'brief.stage', state: 'accepted', phase: 'completed',
          reply: { staging_status: 'staged', owner: 'brief_staging', count: 1, outcome_unknown: false } });
        return { state: 'submitted', id: 7, generation: 1 };
      }, run: (session, request) => fixture.submit(request) }, () => {});
    brief.observe({ state: 'ready', features, results: [], observation: { run_mode: 'issue-run' } });
    const result = await brief.submit('committed Brief'); await brief.submit('must not restage');
    return { result, blocked: brief.blocked, staged, requests: fixture.requests };
  });
  expect(observed).toMatchObject({ result: { status: 'rejected', staged: true }, blocked: true, staged: 1, requests: [] });
  expect(observed.result.stagingRequest).toMatchObject({ state: 'submitted', id: 7, generation: 1 });
  expect(observed.result.runRequest).toBeUndefined();
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
