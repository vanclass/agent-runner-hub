import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('work v1 binds only authenticated ready generations', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('ready', 9);
    const work = new RunnerWork({ identity: () => ({ session: 'ready', generation: 9 }), available: () => true,
      submit: (_, request) => fixture.submit(request) }, () => {});
    work.observe('ready', 'connecting', { generation: 0, results: [] });
    fixture.changed = () => work.observe('ready', 'ready', structuredClone(fixture.features));
    fixture.changed(); const attempt = await work.submit('once');
    return { identity: attempt.identity, started: attempt.work.started_event_id };
  });
  expect(result).toEqual({ identity: { session: 'ready', generation: 9 }, started: 3 });
});

test('work v1 keeps dispatch admission and canonical start distinct with original request correlation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('owned', 7), identity = { session: 'owned', generation: 7 };
    fixture.holdSubmit = true;
    const work = new RunnerWork({ identity: () => identity, available: () => true,
      submit: (_, request) => fixture.submit(request) }, () => {});
    fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features));
    fixture.changed();
    const submission = work.submit('exact instruction\n안녕 🌍');
    await new Promise(r => setTimeout(r, 0));
    const queued = structuredClone(work.current);
    fixture.releaseSubmit();
    const final = await submission;
    return { queued, final, requests: fixture.requests };
  });
  expect(result.queued.submissionId).toBe(1001);
  expect(result.queued.instruction).toBe('exact instruction\n안녕 🌍');
  expect(result.queued.work).toBeUndefined();
  expect(result.final.submission.reply.receipt).toBe('dispatch_received');
  expect(result.final.submission.reply.work.admission).toBe('pending');
  expect(result.final.submission.reply.work.started_event_id).toBe(0);
  expect(result.final.work.started_event_id).toBe(3);
  expect(result.final.work.terminal).toBe(false);
  expect(result.final.instruction).toBe(result.queued.instruction);
  expect(result.requests).toEqual([{ operation: 'work.submit', api_version: 1, instruction: 'exact instruction\n안녕 🌍' },
    { operation: 'work.status', api_version: 1, submission_request_id: 1001 }]);
});

for (const mode of ['rejected', 'suspended', 'incomplete', 'unknown', 'succeeded', 'failed', 'interrupted']) {
  test('work v1 preserves ' + mode + ' without inferring whole Task completion', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async mode => {
      const { RunnerWork } = await import('/src/hub/runnerWork.ts');
      const { WorkFixture } = await import('/tests/fixtures/work.ts');
      const fixture = new WorkFixture('owned'), identity = { session: 'owned', generation: 1 };
      fixture.mode = mode;
      const work = new RunnerWork({ identity: () => identity, available: () => true,
        submit: (_, request) => fixture.submit(request) }, () => {});
      fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features)); fixture.changed();
      const attempt = await work.submit('once');
      let refused = false;
      try { await work.submit('once'); } catch { refused = true; }
      return { attempt, refused, submissions: fixture.requests.filter(r => r.operation === 'work.submit').length };
    }, mode);
    expect(result.attempt.work.state).toBe(mode);
    expect(result.attempt.work.terminal).toBe(['rejected', 'succeeded', 'failed', 'interrupted'].includes(mode));
    if (!['rejected', 'succeeded', 'failed', 'interrupted'].includes(mode)) { expect(result.refused).toBe(true); expect(result.submissions).toBe(1); }
  });
}
for (const fault of ['lost-admission', 'crossed', 'not-sent']) {
  test('work v1 handles ' + fault + ' without replaying uncertain submission', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async fault => {
      const { RunnerWork } = await import('/src/hub/runnerWork.ts');
      const { WorkFixture } = await import('/tests/fixtures/work.ts');
      const fixture = new WorkFixture('owned'), identity = { session: 'owned', generation: 1 };
      fixture.fault = fault;
      const work = new RunnerWork({ identity: () => identity, available: () => true,
        submit: (_, request) => fixture.submit(request) }, () => {});
      fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features)); fixture.changed();
      await work.submit('once');
      const count = fixture.requests.length;
      let refused = false;
      if (fault !== 'not-sent') try { await work.submit('once'); } catch { refused = true; }
      return { attempt: work.current, refused, count, after: fixture.requests.length };
    }, fault);
    expect(result.attempt.notSent).toBe(fault === 'not-sent');
    expect(result.attempt.uncertain).toBe(fault !== 'not-sent');
    if (fault !== 'not-sent') { expect(result.refused).toBe(true); expect(result.after).toBe(result.count); }
  });
}
test('work v1 fences session generations EOF and regressing event evidence', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('owned'), identity = { session: 'owned', generation: 1 };
    const work = new RunnerWork({ identity: () => identity, available: () => true,
      submit: (_, request) => fixture.submit(request) }, () => {});
    fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features)); fixture.changed();
    await work.submit('once');
    fixture.work.event_id = 1; fixture.mode = 'dispatch';
    await work.refreshStatus();
    const regressed = work.current.uncertain;
    identity.generation = 2; fixture.features.generation = 2; fixture.changed();
    let refused = false; try { await work.submit('once'); } catch { refused = true; }
    return { regressed, refused, supported: work.supported, count: fixture.requests.filter(r => r.operation === 'work.submit').length };
  });
  expect(result).toEqual({ regressed: true, refused: true, supported: false, count: 1 });
});
