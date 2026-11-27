import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

test('connected observations retain verified state through conflict, storage failure and stale completion', async ({ page }) => {
  await page.goto('/');
  const observed = await page.evaluate(async () => {
    const { RunnerRecovery } = await import('/src/hub/RunnerRecovery.ts');
    const { RunnerWorkspace, runnerWorkspaceKey } = await import('/src/hub/RunnerWorkspace.ts');
    const reference = { version: 1, family: 'task-run', repository_namespace: 'project-exact',
      task_number: '42', task_workload_id: 'exact' };
    const saved = { runMode: 'task-run', reference, state: 'eligible' };
    const workspace = new RunnerWorkspace();
    const tab = { id: '10000000-0000-4000-8000-000000000001', name: 'Exact', createdOrder: 1,
      installationRoot: '/fixture/install', launchOnOpen: true };
    workspace.save([{ ...tab, recovery: saved }]);
    const snapshot = { generation: 1, results: [], recovery: { version: 1, connected_version: 1,
      eligibility_version: 1, connected_run_modes: ['task-run'], operations: ['recovery.current'] } };
    let id = 0;
    const recovery = new RunnerRecovery(saved, false, { completionMs: 1000,
      submit: async () => ({ state: 'submitted', id: ++id, generation: snapshot.generation }),
    }, () => workspace.save([{ ...tab, recovery: recovery.saved }]));
    const start = () => recovery.observe(snapshot, true, true, 'task-run', String(id + 1));
    const reply = async (reference_status, reference = null) => {
      const lifecycle = reference && { reference, lifecycle_version: 1, run_mode: 'task-run',
        authoritative: true, eligibility: 'eligible' };
      snapshot.results.push({ id, feature: 'recovery', operation: 'recovery.current', state: 'accepted',
        phase: 'completed', reply: { connected_version: 1, run_mode: 'task-run', reference_status, reference, lifecycle } });
      recovery.observe(snapshot, true, false);
      await new Promise(r => setTimeout(r, 0));
    };
    start();
    const nonblocking = !recovery.busy;
    await reply('identity_conflict');
    const conflict = recovery.saved;
    const replacement = { ...reference, task_workload_id: 'replacement' };
    start();
    await reply('present', replacement);
    const replaced = recovery.saved;
    start();
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('fixture quota'); };
    try { await reply('absent'); } finally { Storage.prototype.setItem = write; }
    const failed = { live: recovery.saved, stored: JSON.parse(localStorage.getItem(runnerWorkspaceKey)).tabs[0].recovery,
      code: recovery.code };
    start();
    recovery.restore(replaced, false);
    await reply('absent');
    const stale = recovery.saved;
    start();
    await reply('absent');
    const cleared = recovery.saved;
    recovery.close();
    return { saved, replacement, nonblocking, conflict, replaced, failed, stale, cleared };
  });
  expect(observed.nonblocking).toBe(true);
  expect(observed.conflict).toEqual(observed.saved);
  expect(observed.replaced.reference).toEqual(observed.replacement);
  expect(observed.failed).toEqual({ live: observed.replaced, stored: observed.replaced, code: 'RECOVERY_SAVE_FAILED' });
  expect(observed.stale).toEqual(observed.replaced);
  expect(observed.cleared).toEqual({ runMode: 'task-run', state: 'eligible' });
});
