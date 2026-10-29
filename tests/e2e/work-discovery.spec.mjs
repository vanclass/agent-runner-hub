import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('promotion projection retains old discovery evidence, admits new events and cannot hide unsafe authority', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { work, fixture, terminalWork } = window.__discovery;
    fixture.observations.set('terminal:1', terminalWork(1, 2, { state: 'succeeded', outcome: 'succeeded', terminal: true }));
    fixture.changed(); await work.refreshInventory(); work.suspendDiscovery(); work.beginPresentation();
    const old = work.current;
    if (work.presentedCurrent || work.unread || work.presentedActivity !== 'idle') throw new Error('old presentation');
    fixture.observations.set('terminal:1', { ...old.work, event_id: 3, owner_revision: 1 });
    await work.refreshInventory();
    if (work.presentedCurrent || work.unread || work.current !== old) throw new Error('late old result');
    fixture.observations.set('terminal:2', terminalWork(2, 4, { state: 'succeeded', outcome: 'succeeded', terminal: true }));
    await work.refreshInventory();
    if (work.presentedCurrent?.work?.observation_id !== 'terminal:2' || !work.unread) throw new Error('lost new event');
    fixture.observations.set('terminal:3', terminalWork(3, 5)); await work.refreshInventory();
    work.beginPresentation();
    if (!work.blocked) throw new Error('active work became safe');
    fixture.observations.set('terminal:3', terminalWork(3, 6, { state: 'unknown', outcome: 'unknown', terminal: true }));
    await work.refreshInventory(); work.beginPresentation();
    if (!work.blocked || work.attempts.length !== 3) throw new Error('uncertain authority lost');
    work.close();
  });
});

async function setup(page, changes = {}) {
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async changes => {
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture, terminalWork } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('owned');
    fixture.enableDiscovery(2);
    const identity = { session: 'owned', generation: 1 };
    let available = true;
    const work = new RunnerWork({ identity: () => identity, available: () => available,
      submit: (session, request) => {
        if (session !== identity.session) throw new Error('crossed session');
        return fixture.submit(request);
      } }, () => {});
    Object.assign(fixture.features.work, changes);
    fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features));
    window.__discovery = { fixture, work, identity, terminalWork, available: value => { available = value; } };
  }, changes);
}

test('work discovery waits for authenticated readiness and pages sequential short work without duplicate notifications', async ({ page }) => {
  await setup(page);
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => window.__discovery.fixture.requests)).toEqual([]);
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery;
    for (let n = 1; n <= 3; n++) fixture.observations.set(`terminal:${n}`, terminalWork(n, n * 2,
      { started_event_id: n * 2 - 1, state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    fixture.changed();
  });
  await page.clock.runFor(3200);
  expect(await page.evaluate(() => {
    const { work, fixture } = window.__discovery;
    return { count: work.attempts.length, activity: work.activity, unread: work.unread,
      cursors: fixture.requests.map(r => r.after_event_id), submissions: work.attempts.map(a => a.work.submission_request_id) };
  })).toEqual({ count: 3, activity: 'completed', unread: true, cursors: [0, 4, 6], submissions: [null, null, null] });
  await page.evaluate(() => {
    const { work, fixture } = window.__discovery;
    work.setViewed(true); work.setViewed(false);
    const previous = fixture.observations.get('terminal:1');
    fixture.observations.set('terminal:1', { ...previous, event_id: 7, owner_revision: 1 });
  });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => ({ count: window.__discovery.work.attempts.length, unread: window.__discovery.work.unread })))
    .toEqual({ count: 3, unread: false });
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery;
    fixture.observations.set('terminal:4', terminalWork(4, 8, { state: 'succeeded', terminal: true, outcome: 'succeeded' }));
  });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => ({ count: window.__discovery.work.attempts.length, unread: window.__discovery.work.unread })))
    .toEqual({ count: 4, unread: true });
  expect(await page.evaluate(() => window.__discovery.fixture.requests.at(-1).after_event_id)).toBe(7);
});

test('work discovery retains unread across new work and rejects repeated page evidence', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery;
    fixture.observations.set('terminal:1', terminalWork(1, 1, { state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    fixture.changed();
  });
  await page.clock.runFor(1600);
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery;
    fixture.observations.set('terminal:2', terminalWork(2, 2));
  });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => ({ activity: window.__discovery.work.activity, unread: window.__discovery.work.unread })))
    .toEqual({ activity: 'running', unread: true });
  await page.evaluate(() => {
    const { fixture, work } = window.__discovery, send = fixture.submit.bind(fixture);
    work.setViewed(true); work.setViewed(false);
    fixture.submit = async request => {
      const admission = await send(request);
      fixture.features.results.at(-1).reply = { works: [...fixture.observations.values()], has_more: false, latest_event_id: 2, next_after_event_id: 2 };
      fixture.changed(); return admission;
    };
  });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => ({ count: window.__discovery.work.attempts.length, unread: window.__discovery.work.unread })))
    .toEqual({ count: 2, unread: false });
});
test('work discovery merges API receipts and list observations into the original attempt', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { fixture, work } = window.__discovery;
    fixture.changed(); window.__originalAttempt = await work.submit('one instruction');
    fixture.mode = 'succeeded'; await work.refreshStatus();
    work.setViewed(true); work.setViewed(false);
  });
  await page.clock.runFor(3200);
  const result = await page.evaluate(() => {
    const { fixture, work } = window.__discovery, attempt = window.__originalAttempt;
    return { count: work.attempts.length, sameAttempt: work.current === attempt, key: attempt.observationId,
      receipt: attempt.submission.reply.receipt, unread: work.unread, activity: work.activity,
      submits: fixture.requests.filter(r => r.operation === 'work.submit').length,
      observes: fixture.requests.filter(r => r.operation === 'work.observe').map(r => r.observation_id) };
  });
  expect(result).toEqual({ count: 1, sameAttempt: true, key: 'api:1001', receipt: 'dispatch_received',
    unread: false, activity: 'completed', submits: 1, observes: ['api:1001', 'api:1001'] });
});

for (const [state, terminal, outcome, activity, unread] of [
  ['succeeded', false, 'succeeded', 'running', false],
  ['suspended', false, 'interrupted', 'attention', false],
  ['incomplete', true, 'incomplete', 'attention', true],
  ['failed', true, 'failed', 'failed', true],
  ['interrupted', true, 'interrupted', 'interrupted', true],
  ['unknown', true, 'unknown', 'unknown', false],
]) {
  test(`work discovery preserves ${state}/${terminal}/${outcome} without inferred success`, async ({ page }) => {
    await setup(page);
    await page.evaluate(({ state, terminal, outcome }) => {
      const { fixture, terminalWork } = window.__discovery;
      fixture.observations.set('terminal:1', terminalWork(1, 2, { run_mode: 'issue-run', work_id: { kind: 'issue', id: 'aggregate' },
        started_event_id: 1, state, terminal, outcome }));
      fixture.changed();
    }, { state, terminal, outcome });
    await page.clock.runFor(1600);
    expect(await page.evaluate(() => ({ activity: window.__discovery.work.activity, unread: window.__discovery.work.unread })))
      .toEqual({ activity, unread });
  });
}

test('work discovery keeps unfinished older observations active and rereads terminal identities with work.observe', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery;
    fixture.observations.set('terminal:1', terminalWork(1, 1));
    fixture.observations.set('terminal:2', terminalWork(2, 2, { state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    fixture.changed();
  });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => ({ activity: window.__discovery.work.activity, blocked: window.__discovery.work.blocked })))
    .toEqual({ activity: 'running', blocked: true });
  await page.evaluate(async () => {
    const { fixture, work } = window.__discovery;
    fixture.observations.set('terminal:3', window.__discovery.terminalWork(3, 3)); fixture.changed();
  });
  await page.clock.runFor(1600);
  await page.evaluate(async () => { await window.__discovery.work.refreshStatus(); });
  expect(await page.evaluate(() => window.__discovery.fixture.requests.at(-1)))
    .toEqual({ operation: 'work.observe', api_version: 1, observation_id: 'terminal:3' });
});

test('work discovery retains the watermark across incomplete pages and stops on a stale cursor', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery;
    fixture.observations.set('terminal:1', terminalWork(1, 2, { state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    fixture.changed();
  });
  await page.clock.runFor(1600);
  await page.evaluate(() => {
    const { fixture } = window.__discovery, send = fixture.submit.bind(fixture);
    fixture.submit = async request => {
      const admission = await send(request);
      const result = fixture.features.results.at(-1);
      if (request.operation === 'work.list') result.reply = { works: [], has_more: false, latest_event_id: 999 };
      fixture.changed();
      return admission;
    };
  });
  await page.clock.runFor(1600);
  await page.clock.runFor(5100);
  expect(await page.evaluate(() => window.__discovery.fixture.requests.slice(-2).map(r => r.after_event_id))).toEqual([2, 2]);
  await page.evaluate(() => {
    const { fixture } = window.__discovery, send = fixture.submit.bind(fixture);
    fixture.submit = async request => {
      const admission = await send(request);
      Object.assign(fixture.features.results.at(-1), { state: 'outcome-unknown', code: 'WORK_CURSOR_AHEAD', reply: { outcome_unknown: true } });
      fixture.changed();
      return admission;
    };
  });
  await page.clock.runFor(5100);
  const before = await page.evaluate(() => window.__discovery.fixture.requests.length);
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => window.__discovery.fixture.requests.length)).toBe(before);
  expect(await page.evaluate(() => window.__discovery.work.attempts.length)).toBe(1);
});

test('work discovery does not overlap reads and fences late results after owning generation changes', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const { fixture, terminalWork } = window.__discovery, send = fixture.submit.bind(fixture);
    fixture.observations.set('terminal:1', terminalWork(1, 2, { state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    const gate = new Promise(resolve => { window.__releaseList = resolve; });
    fixture.submit = async request => { await gate; return send(request); };
    fixture.changed();
  });
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => ({ busy: window.__discovery.work.busy, writing: window.__discovery.work.writing,
    requests: window.__discovery.fixture.requests.length }))).toEqual({ busy: true, writing: false, requests: 0 });
  await page.evaluate(() => {
    const { fixture, identity } = window.__discovery;
    identity.generation = 2; fixture.features.generation = 2; fixture.changed(); window.__releaseList();
  });
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => ({ count: window.__discovery.work.attempts.length, unread: window.__discovery.work.unread })))
    .toEqual({ count: 0, unread: false });
});

test('work discovery unsupported operations preserve API tracking and exact-session disconnect stops reads', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { fixture, work } = window.__discovery;
    fixture.changed(); await work.submit('one API instruction');
    const send = fixture.submit.bind(fixture);
    fixture.submit = async request => {
      const admission = await send(request);
      if (request.operation === 'work.list') {
        Object.assign(fixture.features.results.at(-1), { state: 'rejected', code: 'UNSUPPORTED_FEATURE', reply: {} });
        fixture.changed();
      }
      return admission;
    };
  });
  await page.clock.runFor(4800);
  expect(await page.evaluate(() => window.__discovery.fixture.requests.filter(r => r.operation === 'work.submit'))).toHaveLength(1);
  expect(await page.evaluate(() => window.__discovery.fixture.requests.some(r => r.operation === 'work.status'))).toBe(true);
  await page.evaluate(() => {
    const { fixture, work } = window.__discovery; work.observe('owned', 'disconnected', structuredClone(fixture.features));
  });
  const before = await page.evaluate(() => window.__discovery.fixture.requests.length);
  await page.clock.runFor(10000);
  expect(await page.evaluate(() => window.__discovery.fixture.requests.length)).toBe(before);
  expect(await page.evaluate(() => ({ activity: window.__discovery.work.activity, unread: window.__discovery.work.unread })))
    .toEqual({ activity: 'unknown', unread: false });
});
test('work discovery falls back to legacy API tracking for unsupported capability origins', async ({ page }) => {
  await setup(page, { origins: ['api', 'api'] });
  await page.evaluate(async () => { const { fixture, work } = window.__discovery; fixture.changed(); await work.submit('legacy API'); });
  await page.clock.runFor(1600);
  expect(await page.evaluate(() => window.__discovery.fixture.requests.every(r => ['work.submit', 'work.status'].includes(r.operation)))).toBe(true);
});
