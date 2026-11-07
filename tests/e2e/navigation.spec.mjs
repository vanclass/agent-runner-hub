import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('navigation work presentation excludes settings, rejection and delayed prior-UUID updates', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerNavigation } = await import('/src/hub/RunnerNavigation.ts');
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture, terminalWork } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('owned'), identity = { session: 'owned', generation: 1 };
    const work = new RunnerWork({ identity: () => identity, available: () => true,
      submit: (session, request) => fixture.submit(request) }, () => {});
    fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features));
    const nav = new RunnerNavigation(() => {});
    nav.observe('old', work); const empty = nav.snapshot;
    fixture.observations.set('terminal:1', terminalWork(1, 1, { run_mode: 'issue-run', started_event_id: 0,
      state: 'rejected', admission: 'rejected', terminal: true, outcome: 'rejected' }));
    fixture.changed(); await work.refreshInventory(); nav.observe('old', work); const rejected = nav.snapshot;
    fixture.observations.set('terminal:2', terminalWork(2, 2, { run_mode: 'task-run', terminal: true, state: 'unknown', outcome: 'unknown' }));
    await work.refreshInventory(); nav.observe('old', work); work.beginPresentation();
    nav.intent('new', 'direct-run'); nav.observe('new', work);
    fixture.observations.set('terminal:2', terminalWork(2, 3, { run_mode: 'task-run', started_event_id: 2,
      terminal: true, state: 'unknown', outcome: 'unknown', owner_revision: 1 }));
    await work.refreshInventory(); nav.observe('new', work); const reused = nav.snapshot;
    fixture.observations.set('terminal:3', terminalWork(3, 4, { run_mode: 'pure-direct-run' }));
    await work.refreshInventory(); nav.observe('new', work); const next = nav.snapshot;
    fixture.observations.set('terminal:4', terminalWork(4, 5, { run_mode: 'issue-run', started_event_id: 1 }));
    await work.refreshInventory(); nav.observe('new', work); const delayed = nav.snapshot;
    nav.observe('new', work); const duplicate = nav.snapshot;
    work.close(); return { empty, rejected, reused, next, delayed, duplicate };
  });
  expect(result.empty).toEqual({ executedModes: [], affinities: {}, order: [] });
  expect(result.rejected).toEqual(result.empty);
  expect(result.reused).toEqual({ executedModes: ['task-run'], order: [], affinities: { old: 'task-run', new: 'direct-run' } });
  expect(result.next.affinities.new).toBe('pure-direct-run');
  expect(result.delayed.affinities.new).toBe('pure-direct-run');
  expect(result.delayed.executedModes).toEqual(['task-run', 'pure-direct-run', 'issue-run']);
  expect(result.duplicate).toEqual(result.delayed);
});

test('navigation does not promote conflicting unknown-outcome start evidence', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerNavigation } = await import('/src/hub/RunnerNavigation.ts');
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture, terminalWork } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('owned'), identity = { session: 'owned', generation: 1 };
    const work = new RunnerWork({ identity: () => identity, available: () => true,
      submit: (session, request) => fixture.submit(request) }, () => {});
    fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features));
    const nav = new RunnerNavigation(() => {});
    const original = terminalWork(1, 1, { state: 'unknown', terminal: true, outcome: 'unknown' });
    fixture.observations.set('terminal:1', original); fixture.changed(); await work.refreshInventory();
    fixture.observations.set('terminal:1', { ...original, event_id: 2, started_event_id: 2 });
    await work.refreshInventory(); nav.observe('tab', work);
    work.close(); return { snapshot: nav.snapshot, uncertain: work.current.uncertain };
  });
  expect(result).toEqual({ snapshot: { executedModes: [], order: [], affinities: {} }, uncertain: true });
});

for (const origin of ['api', 'terminal']) {
  test(`navigation preserves confirmed unknown-outcome ${origin} starts without inferring success`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async origin => {
      const { RunnerNavigation } = await import('/src/hub/RunnerNavigation.ts');
      const { RunnerWork, runModes } = await import('/src/hub/runnerWork.ts');
      const { WorkFixture, terminalWork } = await import('/tests/fixtures/work.ts');
      const { RunnerWorkspace } = await import('/src/hub/RunnerWorkspace.ts');
      const id = '12345678-1234-1234-1234-123456789abc', fixture = new WorkFixture('owned');
      const identity = { session: 'owned', generation: 1 };
      const work = new RunnerWork({ identity: () => identity, available: () => true,
        submit: (session, request) => fixture.submit(request) }, () => {});
      fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features));
      const nav = new RunnerNavigation(() => {}), checks = [];
      const tab = { id, name: 'Unknown result', createdOrder: 1, installationRoot: '/fixture/install', launchOnOpen: false };
      fixture.changed();
      for (const [index, mode] of runModes.entries()) {
        const event = index * 3 + 1, key = `${origin}:${index + 1}`;
        const observation = terminalWork(index + 1, event, { observation_id: key, origin,
          submission_request_id: origin === 'api' ? index + 1 : null, run_mode: mode,
          state: 'unknown', terminal: true, outcome: 'unknown', admission: 'unknown', started_event_id: 0 });
        fixture.observations.set(key, observation); await work.refreshInventory(); nav.observe(id, work);
        const unconfirmed = nav.snapshot;
        fixture.observations.set(key, { ...observation, event_id: event + 1, admission: 'admitted' });
        await work.refreshInventory(); nav.observe(id, work); const admissionOnly = nav.snapshot;
        fixture.observations.set(key, { ...observation, event_id: event + 2, admission: 'admitted', started_event_id: event + 1 });
        await work.refreshInventory(); nav.observe(id, work); const confirmed = nav.snapshot;
        nav.observe(id, work); const duplicate = nav.snapshot;
        const workspace = new RunnerWorkspace(); workspace.load(); const saved = workspace.save([tab], confirmed);
        const restored = new RunnerWorkspace(); restored.load();
        const reloaded = new RunnerNavigation(() => {}); reloaded.restore(restored.presentation);
        const domains = reloaded.project([tab], 'run-mode').map(d => ({ id: d.id, tabs: d.runners.map(t => t.id) }));
        checks.push({ mode, unconfirmed, admissionOnly, confirmed, duplicate, saved, restored: reloaded.snapshot,
          domains, uncertain: work.current.uncertain, activity: work.activity, blocked: work.blocked, unread: work.unread });
      }
      work.close(); return { checks };
    }, origin);
    const modes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'];
    for (const [index, check] of result.checks.entries()) {
      expect(check.unconfirmed.executedModes).toEqual(modes.slice(0, index));
      expect(check.admissionOnly).toEqual(check.unconfirmed);
      expect(check.confirmed.executedModes).toEqual(modes.slice(0, index + 1));
      expect(Object.values(check.confirmed.affinities)).toEqual([check.mode]);
      expect(check.duplicate).toEqual(check.confirmed);
      expect(check.saved).toBe(true); expect(check.restored).toEqual(check.confirmed);
      expect(check.domains.find(d => d.id === check.mode).tabs).toEqual(['12345678-1234-1234-1234-123456789abc']);
      expect(check).toMatchObject({ uncertain: true, activity: 'unknown', blocked: true, unread: false });
    }
  });
}

test('navigation storage validates optional v1 metadata and retains malformed or failed writes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWorkspace, runnerWorkspaceKey: key } = await import('/src/hub/RunnerWorkspace.ts');
    const { HubPreferences, hubPreferencesKey: pref } = await import('/src/hub/preferences.ts');
    const tab = { id: '12345678-1234-1234-1234-123456789abc', name: 'Preserved', createdOrder: 1,
      installationRoot: '/fixture/install', launchOnOpen: false };
    const old = JSON.stringify({ version: 1, tabs: [tab] }); localStorage.setItem(key, old);
    const workspace = new RunnerWorkspace(); const loaded = workspace.load();
    const initial = workspace.presentation;
    const metadata = { executedModes: ['task-run'], affinities: { [tab.id]: 'task-run' }, order: [tab.id],
      draft: 'must not store', token: 'must not store' };
    const refused = workspace.save(loaded, metadata);
    const noLeak = localStorage.getItem(key) === old;
    const invalid = JSON.stringify({ version: 1, tabs: [tab], presentation: { executedModes: ['unsupported'], affinities: {}, order: [] } });
    localStorage.setItem(key, invalid); const malformed = new RunnerWorkspace(); malformed.load();
    const protectedWrite = malformed.save([]), retained = localStorage.getItem(key) === invalid;
    localStorage.setItem(key, old); const failing = new RunnerWorkspace(); failing.load();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('quota fixture', 'QuotaExceededError'); return original.call(this, name, value); };
    const write = failing.save(loaded, { executedModes: ['task-run'], affinities: {}, order: [] });
    const afterFailure = localStorage.getItem(key); Storage.prototype.setItem = original;
    const retry = failing.save(loaded, { executedModes: ['task-run'], affinities: {}, order: [] });
    localStorage.setItem(pref, JSON.stringify({ version: 1, language: 'en', theme: 'light', singleEntry: {} }));
    const preferences = new HubPreferences(), absent = preferences.value.domainDisplay;
    preferences.update({ domainDisplay: 'run-mode' }); const restored = new HubPreferences().value.domainDisplay;
    return { initial, refused, noLeak, protectedWrite, retained, write, afterFailure, old, retry, absent, restored };
  });
  expect(result.initial).toEqual({ executedModes: [], order: [], affinities: {} });
  expect(result.refused).toBe(false); expect(result.noLeak).toBe(true);
  expect(result.protectedWrite).toBe(false); expect(result.retained).toBe(true);
  expect(result.write).toBe(false); expect(result.afterFailure).toBe(result.old); expect(result.retry).toBe(true);
  expect(result.absent).toBeUndefined(); expect(result.restored).toBe('run-mode');
});

test('navigation stale drag snapshot rejects removal, membership change and cancellation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerNavigation } = await import('/src/hub/RunnerNavigation.ts');
    let writes = 0; const nav = new RunnerNavigation(() => writes++);
    nav.restore({ executedModes: ['task-run', 'issue-run'], order: [], affinities: { a: 'task-run', b: 'task-run', c: 'issue-run' } });
    const tabs = ['a', 'b', 'c'].map((id, i) => ({ id, createdOrder: i + 1, name: id, status: 'idle' }));
    nav.reorder(tabs, 'run-mode', 'issue-run', 'a', 'c', ['c']);
    nav.reorder(tabs.slice(1), 'run-mode', 'task-run', 'a', null, ['a', 'b']);
    nav.intent('b', 'issue-run'); const afterIntent = writes;
    nav.reorder(tabs, 'run-mode', 'task-run', 'a', null, ['a', 'b']);
    return { order: nav.snapshot.order, writes, afterIntent };
  });
  expect(result.order).toEqual([]); expect(result.writes).toBe(result.afterIntent);
});
