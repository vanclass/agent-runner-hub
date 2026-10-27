import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

async function owners(page, runMode = 'task-run') {
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async runMode => {
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture } = await import('/tests/fixtures/work.ts');
    window.__workOwners = [];
    for (const session of ['first', 'second']) {
      const fixture = new WorkFixture(session), identity = { session, generation: 1 };
      fixture.config.current.run_mode = runMode;
      const work = new RunnerWork({ identity: () => identity, available: () => true,
        submit: (id, request) => { if (id !== session) throw new Error('crossed session'); return fixture.submit(request); } }, () => {});
      fixture.changed = () => work.observe(session, 'ready', structuredClone(fixture.features));
      fixture.changed(); await work.submit(session);
      window.__workOwners.push({ fixture, work, identity });
    }
  }, runMode);
}
for (const runMode of ['task-run', 'issue-run']) {
  test(`background work ${runMode} incomplete and intermediate success require whole-work terminal evidence`, async ({ page }) => {
    await owners(page, runMode);
    await page.evaluate(() => { window.__workOwners[0].fixture.mode = 'incomplete'; });
    await page.clock.runFor(1600);
    expect(await page.evaluate(() => window.__workOwners[0].work.activity)).toBe('attention');
    expect(await page.evaluate(() => window.__workOwners[0].work.current.work.work_id.kind)).toBe(runMode === 'task-run' ? 'task' : 'issue');
    await page.evaluate(() => {
      const fixture = window.__workOwners[0].fixture;
      fixture.mode = 'dispatch';
      Object.assign(fixture.work, { state: 'succeeded', outcome: 'succeeded', terminal: false, event_id: fixture.work.event_id + 1 });
    });
    await page.clock.runFor(1600);
    expect(await page.evaluate(() => window.__workOwners[0].work.activity)).toBe('running');
    expect(await page.evaluate(() => window.__workOwners[0].work.unread)).toBe(false);
    await page.evaluate(() => { window.__workOwners[0].fixture.mode = 'succeeded'; });
    await page.clock.runFor(1600);
    expect(await page.evaluate(() => window.__workOwners[0].work.activity)).toBe('completed');
    expect(await page.evaluate(() => window.__workOwners[0].work.unread)).toBe(true);
  });
}
for (const outcome of ['succeeded', 'failed', 'interrupted']) {
  test(`background work original identity, duplicate events, unread and terminal stop ${outcome}`, async ({ page }) => {
    await owners(page);
    await page.clock.runFor(3200);
    const unchanged = await page.evaluate(() => window.__workOwners.map(({ fixture, work }) => ({
      count: fixture.requests.length, event: work.current.work.event_id, activity: work.activity, unread: work.unread })));
    expect(unchanged).toEqual([{ count: 4, event: 4, activity: 'running', unread: false },
      { count: 4, event: 4, activity: 'running', unread: false }]);
    await page.evaluate(outcome => { window.__workOwners[0].fixture.mode = outcome; }, outcome);
    await page.clock.runFor(1600);
    const terminal = await page.evaluate(() => {
      const [first, second] = window.__workOwners;
      const receipt = { activity: first.work.activity, unread: first.work.unread,
        neighbor: second.work.activity, requests: structuredClone(first.fixture.requests) };
      first.work.setViewed(true); first.work.setViewed(false); first.fixture.changed();
      return { ...receipt, afterView: first.work.unread };
    });
    expect(terminal.activity).toBe(outcome === 'succeeded' ? 'completed' : outcome);
    expect(terminal.unread).toBe(true); expect(terminal.afterView).toBe(false); expect(terminal.neighbor).toBe('running');
    expect(terminal.requests.filter(r => r.operation === 'work.submit')).toHaveLength(1);
    expect(terminal.requests.filter(r => r.operation === 'work.status').every(r => r.submission_request_id === 1001)).toBe(true);
    const count = terminal.requests.length;
    await page.clock.runFor(10000);
    expect(await page.evaluate(() => window.__workOwners[0].fixture.requests.length)).toBe(count);
    await page.evaluate(() => window.__workOwners[1].work.close());
    const second = await page.evaluate(() => window.__workOwners[1].fixture.requests.length);
    await page.clock.runFor(10000);
    expect(await page.evaluate(() => window.__workOwners[1].fixture.requests.length)).toBe(second);
  });
}
test('background work unknown recovers through original status and terminal unknown never fabricates completion', async ({ page }) => {
  await owners(page);
  await page.evaluate(() => { window.__workOwners[0].fixture.fault = 'crossed'; });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => window.__workOwners[0].work.activity)).toBe('unknown');
  await page.evaluate(() => { window.__workOwners[0].fixture.fault = ''; window.__workOwners[0].fixture.mode = 'succeeded'; });
  await page.clock.runFor(5100);
  expect(await page.evaluate(() => window.__workOwners[0].work.activity)).toBe('completed');
  await page.evaluate(() => {
    const second = window.__workOwners[1];
    second.fixture.mode = 'dispatch';
    Object.assign(second.fixture.work, { state: 'unknown', outcome: 'unknown', terminal: true, event_id: 10 });
  });
  await page.clock.runFor(1600);
  const final = await page.evaluate(() => ({ activity: window.__workOwners[1].work.activity,
    unread: window.__workOwners[1].work.unread, count: window.__workOwners[1].fixture.requests.length }));
  expect(final.activity).toBe('unknown'); expect(final.unread).toBe(false);
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => window.__workOwners[1].fixture.requests.length)).toBe(final.count);
});
test('background work closes only its exact generation and ignores stale receipts', async ({ page }) => {
  await owners(page);
  await page.evaluate(() => {
    const first = window.__workOwners[0];
    first.identity.generation = 2; first.fixture.features.generation = 2; first.fixture.changed();
    first.fixture.mode = 'succeeded';
  });
  const count = await page.evaluate(() => window.__workOwners[0].fixture.requests.length);
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => window.__workOwners[0].fixture.requests.length)).toBe(count);
  expect(await page.evaluate(() => window.__workOwners[0].work.activity)).toBe('unknown');
  expect(await page.evaluate(() => window.__workOwners[0].work.unread)).toBe(false);
  expect(await page.evaluate(() => window.__workOwners[1].fixture.requests.length)).toBeGreaterThan(count);
});
