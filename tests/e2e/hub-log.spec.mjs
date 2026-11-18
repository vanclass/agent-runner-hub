import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

test('Hub log restores before queued live events, serializes writes and exposes unconfirmed saves', async ({ page }) => {
  await page.goto('/');
  const observed = await page.evaluate(async () => {
    const { HubLog, formatHubRecord } = await import('/src/hub/HubLog.ts');
    const event = code => ({ component: 'configuration', operation: 'apply', runner: 'fixture', target: 'Project/Example',
      expected: 'completed-receipt', actual: 'rejected', code, nextAction: 'inspect-receipt' });
    const old = { ...event('OLD'), timestamp: 1, sequence: 1 }, calls = []; let release;
    const other = { ...old, component: 'work', operation: 'observe', sequence: 2 };
    const blocked = new Promise(resolve => { release = resolve; }); let disk = [old, other];
    const originalBytes = JSON.stringify(disk);
    window.__TAURI_INTERNALS__ = { invoke: async (command, { request }) => {
      calls.push(request); if (calls.length === 1) await blocked;
      if (request.event) disk.push({ ...request.event, sequence: disk.length + 1, timestamp: 2 });
      return { records: structuredClone(disk), issue: null };
    } };
    const log = new HubLog(30); void log.record(event('LIVE')); void log.record(event('NEXT'));
    await Promise.resolve(); const before = calls.length; release(); await log.settled();
    const restored = log.history.map(formatHubRecord);
    const next = new HubLog(30); await next.start();
    const again = next.history.map(formatHubRecord);
    window.__TAURI_INTERNALS__.invoke = async () => { throw 'HUB_LOG_WRITE_FAILED'; };
    await next.record(event('UNSAVED'));
    return { before, calls: calls.map(c => c.event?.code ?? 'load'), restored, again,
      unchanged: JSON.stringify(disk.slice(0, 2)) === originalBytes,
      issue: next.issue, pending: next.pending.map(e => e.code), retained: next.history.length };
  });
  expect(observed.before).toBe(1); expect(observed.calls).toEqual(['load', 'LIVE', 'NEXT', 'load']);
  expect(observed.restored).toEqual(observed.again);
  expect(observed.restored[0].message).not.toBe(observed.restored[1].message);
  expect(observed.unchanged).toBe(true);
  expect(observed.pending).toEqual(['UNSAVED']); expect(observed.issue).toBe('HUB_LOG_WRITE_FAILED');
  expect(observed.retained).toBe(4);
});

test('capture survives presentation detach, deduplicates refresh and projects safe distinct outcomes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { HubLog } = await import('/src/hub/HubLog.ts');
    const { createHubLogCapture } = await import('/src/hub/HubLogCapture.ts');
    let disk = [], refresh, lifecycle;
    window.__TAURI_INTERNALS__ = { invoke: async (_, { request }) => {
      if (request.event) disk.push({ ...request.event, sequence: disk.length + 1, timestamp: 1 });
      return { records: structuredClone(disk), issue: null };
    } };
    const log = new HubLog(30), bind = createHubLogCapture(log);
    const view = { id: 'one', name: 'Runner 1', status: 'running' };
    const control = { snapshot: { state: 'ready', results: [] }, config: { applications: [] }, work: { attempts: [] } };
    const source = { subscribe: fn => { refresh = fn; return () => {}; },
      subscribeLifecycle: fn => { lifecycle = fn; return () => {}; },
      getSnapshot: () => [view], get: () => session, getFailure: () => undefined,
      failures: [], entry: { progress: { key: 'work.retained', values: { state: 'unknown', diagnostic: 'SECRET instruction' } }, phase: 'unknown' },
      spareSnapshot: { detail: '' }, workspace: { issue: '' } };
    const session = { control };
    const stop = bind(source); const detach = log.subscribe(() => {}); detach(); refresh();
    for (let n = 0; n < 4; n++) { source.spareSnapshot.detail = { key: 'spare.preparing' }; refresh(); }
    lifecycle({ operation: 'spare-prepared' });
    lifecycle({ operation: 'spare-promoted', runner: 'Runner 2' });
    lifecycle({ operation: 'spare-prepared' });
    stop();
    const stopAgain = bind(source); await log.settled(); stopAgain();
    return log.history;
  });
  expect(result).toHaveLength(5);
  expect(result.map(e => e.component)).toEqual(Array(5).fill('system'));
  expect(result.filter(e => e.operation === 'spare-promoted')[0].runner).toBe('Runner 2');
  expect(JSON.stringify(result)).not.toContain('SECRET');
});

test('capture retains independent task and apply outcomes while ignoring inspection', async ({ page }) => {
  await page.goto('/');
  const events = await page.evaluate(async () => {
    const { createHubLogCapture } = await import('/src/hub/HubLogCapture.ts');
    const events = []; let refresh;
    const config = { applications: [], progress: { operation: 'session_config.inspect', state: 'failure' } };
    const work = { attempts: [] }, session = { control: { config, work, snapshot: { state: 'ready', results: [] } } };
    const view = { id: 'one', name: 'Runner 1', status: 'running' };
    const source = { subscribe: fn => { refresh = fn; return () => {}; }, subscribeLifecycle: () => () => {},
      getSnapshot: () => [view], get: () => session,
      getFailure: () => undefined, failures: [] };
    const stop = createHubLogCapture({ start: async () => {}, record: async e => events.push(e), prune: async () => {} })(source);
    refresh(); config.progress = { operation: 'session_config.plan', state: 'accepted' }; refresh();
    for (const outcome of ['succeeded', 'failed', 'interrupted', 'incomplete', 'unknown', 'rejected', 'failed']) {
      work.attempts.push({ work: { observation_id: `terminal:${work.attempts.length + 1}`, admission: 'admitted',
        started_event_id: 2, terminal: true, state: outcome, outcome } });
      refresh(); refresh();
    }
    for (const outcome of ['applied', 'failed', 'unknown', 'failed']) {
      config.applications.push({ receipt: { state: 'accepted', code: 'SECRET private error' }, result: { apply_status: outcome } });
      refresh(); refresh();
    }
    for (const state of ['rejected', 'failure', 'outcome-unknown', 'not-sent']) {
      work.attempts.push({ submission: { state, code: 'SECRET private error' } }); refresh(); refresh();
    }
    const unresolved = { receipt: { state: 'accepted' } };
    config.applications.push(unresolved); refresh(); refresh();
    unresolved.result = { apply_status: 'applied' }; refresh(); refresh();
    view.status = 'failed'; refresh(); refresh();
    view.status = 'exited'; refresh(); refresh();
    session.control.snapshot.state = 'disconnected'; refresh(); refresh();
    session.control.snapshot.state = 'ready'; refresh(); refresh();
    stop(); return events;
  });
  expect(events.filter(e => e.operation === 'work-outcome').map(e => e.actual))
    .toEqual(['succeeded', 'failed', 'interrupted', 'incomplete', 'unknown', 'rejected', 'failed']);
  expect(events.filter(e => e.component === 'settings').map(e => e.actual)).toEqual(['applied', 'failed', 'unknown', 'failed', 'unknown', 'applied']);
  expect(events.filter(e => e.operation === 'work-submission').map(e => e.actual))
    .toEqual(['rejected', 'failure', 'outcome-unknown', 'not-sent']);
  expect(events.filter(e => e.operation === 'runner-lifecycle').map(e => e.actual)).toEqual(['running', 'failed', 'exited']);
  expect(events.filter(e => e.operation === 'connection').map(e => e.actual)).toEqual(['ready', 'disconnected', 'ready']);
  expect(events).toHaveLength(37); expect(JSON.stringify(events)).not.toContain('SECRET');
});

test('retention defaults migrate without rewriting, validate days and persist independently', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { HubPreferences, hubPreferencesKey } = await import('/src/hub/preferences.ts');
    const old = JSON.stringify({ version: 1, language: 'en', theme: 'light', singleEntry: {}, confirmRunnerRemoval: true });
    localStorage.setItem(hubPreferencesKey, old);
    const store = new HubPreferences(); const initial = store.logRetentionDays, unchanged = localStorage.getItem(hubPreferencesKey) === old;
    store.update({ hubLogRetentionDays: 7 }); const restored = new HubPreferences();
    for (const invalid of [0, -1, 1.5, NaN, 0x100000000]) restored.update({ hubLogRetentionDays: invalid });
    return { initial, unchanged, retained: restored.logRetentionDays, disk: JSON.parse(localStorage.getItem(hubPreferencesKey)) };
  });
  expect(result.initial).toBe(30); expect(result.unchanged).toBe(true); expect(result.retained).toBe(7);
  expect(result.disk.hubLogRetentionDays).toBe(7);
});

test('Single Entry log view shows storage failure and settings retain a valid value after reload', async ({ page }) => {
  await page.goto('/tests/fixtures/hub.html');
  await expect(page.locator('.hub-log [role="alert"]')).toContainText('HUB_LOG_UNAVAILABLE');
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const days = page.getByRole('spinbutton', { name: 'Hub log retention (days)' });
  await expect(days).toHaveValue('30'); await days.fill('7'); await days.press('Tab');
  await page.keyboard.press('Escape');
  await page.locator('[data-runner-id="first"] .nav-row').click();
  await expect(page.locator('.hub-log')).toHaveCount(0);
  await page.locator('.single-entry').click(); await expect(page.locator('.hub-log')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Hub log retention (days)' })).toHaveValue('7');
});
