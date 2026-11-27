import { chooseAppPreference } from './application-menu.mjs';
import { mountedRunner } from '../native/webdriver/mounted-runner.mjs';

export function registerAutoRecovery({ test, expect, transport }) {
  const key = 'agent-runner-hub.workspace.v1';
  const reference = n => ({ version: 1, family: 'task-run', repository_namespace: 'project-exact',
    task_number: String(n), task_workload_id: 'exact-work-' + n });
  async function seed(page, states, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options });
    await page.addInitScript(({ key, states }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', 'yes');
      localStorage.setItem('agent-runner-hub.installation', '/fixture/install');
      localStorage.setItem(key, JSON.stringify({ version: 1, tabs: states.map((recovery, i) => ({
        id: '10000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), name: 'Exact ' + (i + 1),
        createdOrder: i + 1, installationRoot: '/fixture/install', launchOnOpen: true, recovery,
      })) }));
    }, { key, states });
    await page.goto('/');
    await expect(page.locator('.runner-row')).toHaveCount(states.length);
  }
  const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const calls = page => page.evaluate(() => [...window.__nativeFixture.sessions.values()]
    .flatMap(s => s.recoveries ?? []).filter(r => r.operation === 'recovery.recover'));
  const direct = n => ({ version: 1, family: 'direct-run', session_id: 'origin-' + n, generation_id: 'generation-1',
    thread_id: 'thread-' + n, resume_id: '', source_exec_run_id: 'exec-1' });
  const issue = { version: 1, family: 'issue-run', issue_run_id: 'issue-1',
    created_by_runner_session_id: 'origin', creation_provenance_digest: 'a'.repeat(64) };
  const contexts = [
    { runMode: 'pure-direct-run', reference: direct(1), disposition: 'completed' },
    { runMode: 'direct-run', reference: direct(2), disposition: 'completed', history: 'incomplete' },
    { runMode: 'task-run', reference: reference(1), disposition: 'suspended' },
    { runMode: 'issue-run', reference: issue, disposition: 'incomplete' },
  ];
  const terminal = (page, text) => mountedRunner({ execute: (fn, ...args) =>
    page.evaluate(({ source, args }) => Function('return (' + source + ')')()(...args), { source: String(fn), args }) }, 'buffer', text);
  const restoreRecords = contexts.map(({ runMode, reference }) => ({ runMode, reference, state: 'eligible' }));
  test('connected recovery preserves four exact contexts and replays only in their original tabs', async ({ page }) => {
    await seed(page, restoreRecords, { recoveryContexts: contexts });
    const initial = await saved(page);
    async function verify(launches) {
      await expect.poll(() => calls(page)).toHaveLength(launches * 4);
      await expect.poll(async () => (await saved(page)).tabs.map(tab => tab.recovery)).toEqual(restoreRecords);
      for (const [index, context] of contexts.entries()) {
        await page.locator('.runner-row').nth(index).locator('.nav-row').click();
        const first = context.runMode + ' first', second = context.runMode + ' second';
        await expect.poll(async () => (await terminal(page))?.full).toContain(second);
        const { full, identity, foreground } = await terminal(page, first);
        expect(identity.tab).toBe(initial.tabs[index].id);
        expect(foreground).toBe(2);
        expect(full.split(first)).toHaveLength(2);
        expect(full.indexOf(first)).toBeLessThan(full.indexOf(second));
        expect(full.split(second)).toHaveLength(2);
        if (context.history === 'incomplete')
          await expect(page.locator('.runner-output-diagnostic')).toContainText('only part of the terminal history');
      }
      expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
    }
    await verify(1);
    await page.locator('.runner-management summary').click();
    await page.getByRole('button', { name: 'Restart all Runners', exact: true }).click();
    await verify(2);
    await page.reload();
    await verify(1);
  });
  test('connected recovery restores mode only for ineligible and absent retained work', async ({ page }) => {
    const closed = { ...contexts[1], disposition: 'discarded', ineligible: true };
    const finished = { ...contexts[2], disposition: 'completed', ineligible: true };
    await seed(page, [restoreRecords[1], restoreRecords[2], { runMode: 'pure-direct-run', state: 'eligible' }],
      { recoveryContexts: [closed, finished] });
    await expect.poll(async () => (await saved(page)).tabs.map(tab => tab.recovery)).toEqual(
      ['direct-run', 'task-run', 'pure-direct-run'].map(runMode => ({ runMode, state: 'eligible' })));
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()]
      .slice(0, 3).map(session => session.feature.config.current.run_mode))).toEqual(['direct-run', 'task-run', 'pure-direct-run']);
    expect(await calls(page)).toEqual([]);
  });
  test('connected recovery leaves an unavailable installation and its exact reference in place', async ({ page }) => {
    await seed(page, [restoreRecords[0]], { recoveryContexts: contexts,
      failedLocations: { '/fixture/install': { code: 'missing-installation', detail: 'Fixture installation unavailable' } } });
    await page.locator('.runner-row .nav-row').click();
    await expect(page.locator('.runner-output-diagnostic')).toContainText('missing-installation');
    expect((await saved(page)).tabs[0]).toMatchObject({
      installationRoot: '/fixture/install', launchOnOpen: true, recovery: restoreRecords[0],
    });
    expect(await calls(page)).toEqual([]);
  });
  test('connected recovery keeps work after uncertain receipt and drops explicitly removed tabs', async ({ page }) => {
    await seed(page, [restoreRecords[2]], { recoveryContexts: contexts, recoveryResults: { 'pty-1': 'partial' } });
    await expect.poll(() => calls(page)).toHaveLength(1);
    await expect.poll(async () => (await saved(page)).tabs[0].recovery.state).toBe('attempting');
    await page.reload();
    await page.locator('.runner-row .nav-row').click();
    await expect(page.locator('.runner-output-diagnostic')).toContainText('RECOVERY_PRIOR_ATTEMPT_UNCERTAIN');
    expect(await calls(page)).toEqual([]);
    await page.locator('.runner-row .nav-row').click({ button: 'middle' });
    await page.getByRole('dialog').getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
    await page.reload();
    await expect(page.locator('.runner-row')).toHaveCount(0);
  });
  for (const theme of ['light', 'black']) for (const height of [650, 900]) {
    test('automatic recovery releases terminal height ' + theme + '/' + height, async ({ page }, info) => {
      await page.setViewportSize({ width: 1280, height });
      await seed(page, [{ reference: reference(1), state: 'eligible' }]);
      await page.locator('.runner-row .nav-row').click();
      if (theme === 'black') {
        await chooseAppPreference(page, 'view', 'theme', 'black');
        await page.keyboard.press('Escape');
      }
      await expect(page.locator('.runner-recovery')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Recover earlier work', exact: true })).toHaveCount(0);
      await expect(page.locator('.xterm-screen')).toBeVisible();
      const boxes = await page.locator('.workspace, .output').evaluateAll(els => els.map(e => e.getBoundingClientRect().top));
      expect(boxes[1] - boxes[0]).toBeLessThan(3);
      await info.attach('automatic-recovery-viewport', { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
}
