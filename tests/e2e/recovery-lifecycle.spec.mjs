import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('exact lifecycle observations preserve uncertainty, reject delayed identities and retain failed durable retirement', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerRecovery } = await import('/src/hub/RunnerRecovery.ts');
    const { RunnerWorkspace, runnerWorkspaceKey } = await import('/src/hub/RunnerWorkspace.ts');
    const exact = { version: 1, family: 'task-run', repository_namespace: 'project-exact', task_number: '1', task_workload_id: 'work-1' };
    const next = { ...exact, task_workload_id: 'work-2' };
    const saved = { reference: exact, state: 'eligible' };
    const pause = () => new Promise(r => setTimeout(r, 0));
    const terminal = { reference: exact, lifecycle_version: 1, disposition: 'completed', authoritative: true, terminal: true, ownership: 'available' };
    function setup(restore = true) {
      const requests = [];
      const snapshot = { generation: 1, results: [], recovery: { version: 1, lifecycle_version: 1,
        operations: ['recovery.reference', 'recovery.recover', 'recovery.observe'] } };
      let id = 0;
      const workspace = new RunnerWorkspace();
      const tab = { id: '10000000-0000-4000-8000-000000000001', name: 'Exact', createdOrder: 1,
        installationRoot: '/fixture/install', launchOnOpen: true };
      const owner = new RunnerRecovery(saved, restore, { completionMs: 1000, observeMs: 0,
        submit: async request => { requests.push({ ...request, id: ++id }); return { state: 'submitted', id, generation: snapshot.generation }; }
      }, () => workspace.save([{ ...tab, ...(owner.saved ? { recovery: owner.saved } : {}) }]));
      workspace.save([{ ...tab, recovery: saved }]);
      const tick = async (available = true) => { owner.observe(snapshot, true, available, []); await pause(); };
      const reply = async (value, overrides = {}) => {
        const request = requests.at(-1);
        snapshot.results.push({ id: request.id, feature: 'recovery', operation: request.operation,
          state: 'accepted', phase: 'completed', reply: value, ...overrides });
        await tick();
      };
      return { owner, snapshot, requests, workspace, tick, reply };
    }
    const retained = [];
    for (const disposition of ['suspended', 'incomplete', 'in_use', 'identity_conflict', 'absent', 'unverified']) {
      const f = setup(); await f.tick();
      await f.reply({ ...terminal, disposition, terminal: false, authoritative: ['suspended', 'incomplete', 'in_use'].includes(disposition) });
      retained.push({ disposition, reference: f.owner.saved?.reference, operations: f.requests.map(r => r.operation) });
      await f.reply({ reference: exact, recovery_status: 'recovered', outcome_unknown: false });
      f.owner.close();
    }
    const rejected = [];
    for (const change of [{ reference: next }, { lifecycle_version: 2 }, { authoritative: false }, { terminal: false }, { ownership: 'in_use' }]) {
      const f = setup(false); await f.tick(); await f.reply({ ...terminal, ...change });
      rejected.push(f.owner.saved?.reference); f.owner.close();
    }
    const delayed = setup(false); await delayed.tick();
    delayed.owner.restore({ reference: next, state: 'eligible' }, false);
    await delayed.reply(terminal);
    const superseded = delayed.owner.saved?.reference; delayed.owner.close();
    const stale = setup(); await stale.tick(); stale.snapshot.generation++;
    await stale.reply(terminal);
    const staleResult = { reference: stale.owner.saved?.reference, operations: stale.requests.map(r => r.operation) }; stale.owner.close();
    const crossed = setup(false); await crossed.tick();
    await crossed.reply(terminal, { operation: 'recovery.recover' });
    const operationRetained = !!crossed.owner.saved; crossed.owner.close();
    const held = setup(false); await held.tick();
    await held.tick(); await held.tick(false);
    const nonblocking = { reads: held.requests.length, busy: held.owner.busy }; held.owner.close();
    const failed = setup(false); await failed.tick();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new Error('fixture quota'); };
    await failed.reply(terminal);
    const failure = { reference: failed.owner.saved?.reference, issue: failed.workspace.issue,
      persisted: JSON.parse(localStorage.getItem(runnerWorkspaceKey)).tabs[0].recovery };
    Storage.prototype.setItem = original;
    await failed.tick(); await failed.reply(terminal);
    const persisted = JSON.parse(localStorage.getItem(runnerWorkspaceKey));
    const retired = !failed.owner.saved && !persisted.tabs[0].recovery; failed.owner.close();
    return { exact, next, retained, rejected, superseded, staleResult, operationRetained, nonblocking, failure, retired };
  });
  for (const row of result.retained) {
    expect(row.reference).toEqual(result.exact);
    expect(row.operations).toEqual(['recovery.observe', 'recovery.recover']);
  }
  expect(result.rejected).toEqual(Array(5).fill(result.exact));
  expect(result.superseded).toEqual(result.next);
  expect(result.staleResult).toEqual({ reference: result.exact, operations: ['recovery.observe'] });
  expect(result.operationRetained).toBe(true);
  expect(result.nonblocking).toEqual({ reads: 1, busy: false });
  expect(result.failure.reference).toEqual(result.exact);
  expect(result.failure.persisted).toEqual({ reference: result.exact, state: 'eligible' });
  expect(result.failure.issue).toBeTruthy();
  expect(result.retired).toBe(true);
});
