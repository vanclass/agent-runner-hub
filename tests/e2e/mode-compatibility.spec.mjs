import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

test('mode compatibility admits per-operation support and isolates validated unknown work', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { WorkFixture, terminalWork } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('owned'), identity = { session: 'owned', generation: 1 };
    const work = new RunnerWork({ identity: () => identity, available: () => true,
      submit: (_, request) => fixture.submit(request) }, () => {});
    fixture.features.work.run_modes = ['task-run', 'subagent-run', 'future-run'];
    fixture.features.work.operations = ['work.list', 'work.observe'];
    fixture.changed = () => work.observe('owned', 'ready', structuredClone(fixture.features), 'task-run');
    fixture.changed();
    const support = { send: work.supported, list: work.discoverySupported, status: work.supports('work.status') };
    fixture.observations.set('terminal:1', terminalWork(1, 1));
    fixture.observations.set('terminal:2', terminalWork(2, 2, { run_mode: 'future-run', work_id: { kind: 'future', id: 'future' } }));
    fixture.observations.set('terminal:3', terminalWork(3, 3, { run_mode: 'subagent-run',
      work_id: { kind: 'subagent_turn', id: 'subagent-1', role_id: 'researcher' },
      result: { answer: 'canonical accepted result' }, state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    await work.refreshInventory();
    const entries = work.attempts.map(a => a.work);
    fixture.observations.set('terminal:4', { ...terminalWork(4, 4, { run_mode: 'future-run' }), observation_id: 'api:99' });
    let rejected = false; try { await work.refreshInventory(); } catch { rejected = true; }
    work.observe('owned', 'ready', fixture.features, 'future-run');
    const unknownExecutable = work.supports('work.list');
    work.close(); return { support, entries, rejected, unknownExecutable };
  });
  expect(result.support).toEqual({ send: false, list: true, status: false });
  expect(result.entries.map(w => w.run_mode)).toEqual(['direct-run', 'subagent-run']);
  expect(result.entries[1].result).toEqual({ answer: 'canonical accepted result' });
  expect(result.entries[1].work_id.role_id).toBe('researcher');
  expect(result.rejected).toBe(true); expect(result.unknownExecutable).toBe(false);
});

test('mode compatibility restores known tabs and preserves unsupported presentation through save', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerWorkspace, runnerWorkspaceKey } = await import('/src/hub/RunnerWorkspace.ts');
    const { RunnerNavigation } = await import('/src/hub/RunnerNavigation.ts');
    const tabs = [1, 2, 3].map(n => ({ id: `12345678-1234-1234-1234-123456789ab${n}`,
      name: `Tab ${n}`, createdOrder: n, installationRoot: '/fixture', launchOnOpen: false }));
    const presentation = { executedModes: ['direct-run', 'future-run', 'subagent-run'], order: tabs.map(t => t.id),
      affinities: { [tabs[0].id]: 'direct-run', [tabs[1].id]: 'future-run', [tabs[2].id]: 'subagent-run' } };
    localStorage.setItem(runnerWorkspaceKey, JSON.stringify({ version: 1, tabs, presentation }));
    const workspace = new RunnerWorkspace(), loaded = workspace.load(), nav = new RunnerNavigation(() => {});
    nav.restore(workspace.presentation);
    const domains = nav.project(loaded, 'run-mode').map(d => [d.id, d.runners.map(r => r.name)]);
    const saved = workspace.save(loaded, nav.snapshot);
    return { domains, saved, metadata: JSON.parse(localStorage.getItem(runnerWorkspaceKey)).presentation };
  });
  expect(result.domains).toEqual([['direct-run', ['Tab 1']], ['task-run', ['Tab 2']], ['subagent-run', ['Tab 3']]]);
  expect(result.saved).toBe(true);
  expect(result.metadata.executedModes).toContain('future-run');
  expect(Object.values(result.metadata.affinities)).toContain('future-run');
});
