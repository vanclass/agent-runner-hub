export function registerAutoRecovery({ test, expect, transport, configure, create }) {
  const key = 'agent-runner-hub.workspace.v1';
  const reference = n => ({ version: 1, family: 'task-run', repository_namespace: 'project-exact',
    task_number: String(n), task_workload_id: 'exact-work-' + n });
  async function seed(page, states, options = {}) {
    await transport(page, undefined, { auto: true, work: true, recovery: true, ...options });
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
  for (const count of [1, 3]) test('automatic recovery after unexpected renderer loss with ' + count + ' tabs', async ({ page }) => {
    const references = Array.from({ length: count }, (_, i) => reference(i + 1));
    await seed(page, references.map(reference => ({ reference, state: 'eligible' })));
    await expect.poll(() => calls(page)).toHaveLength(count);
    await expect.poll(async () => (await saved(page)).tabs.map(t => t.recovery.state)).toEqual(references.map(() => 'eligible'));
    const ids = (await saved(page)).tabs.map(t => t.id);
    const cdp = await page.context().newCDPSession(page);
    const crashed = page.waitForEvent('crash');
    void cdp.send('Page.crash').catch(() => {});
    await crashed;
    const next = await page.context().newPage();
    await transport(next, undefined, { auto: true, work: true, recovery: true });
    await next.goto('/');
    await expect.poll(() => calls(next)).toHaveLength(count);
    expect((await calls(next)).map(r => r.reference)).toEqual(references);
    expect((await saved(next)).tabs.map(t => t.id)).toEqual(ids);
    await next.waitForTimeout(1100);
    expect(await calls(next)).toHaveLength(count);
    await next.close();
  });
  test('automatic recovery keeps exact multi-tab references independent and never replays', async ({ page }) => {
    await seed(page, [1, 2, 3].map(n => ({ reference: reference(n), state: 'eligible' })),
      { recoveryResults: { 'pty-2': 'blocked', 'pty-3': 'partial' } });
    await expect.poll(() => calls(page)).toHaveLength(3);
    await expect.poll(async () => (await saved(page)).tabs.map(t => t.recovery.state)).toEqual(['eligible', 'blocked', 'partial']);
    expect((await calls(page)).map(r => r.reference)).toEqual([1, 2, 3].map(reference));
    await page.waitForTimeout(1600);
    expect(await calls(page)).toHaveLength(3);
    expect(await page.evaluate(() => [window.__nativeFixture.commands, window.__nativeFixture.writes])).toEqual([[], []]);
    await page.locator('.runner-row').nth(2).locator('.nav-row').click();
    await expect(page.locator('.quiet-status')).toContainText('uncertain');
    await expect(page.locator('.runner-recovery')).toHaveCount(0);
  });
  for (const outcome of ['absent', 'identity_conflict', 'interaction_required', 'unverified', 'partial']) {
    test('automatic recovery classifies ' + outcome + ' without fallback', async ({ page }) => {
      await seed(page, [{ reference: reference(1), state: 'eligible' }], { recoveryResults: { 'pty-1': outcome } });
      await expect.poll(async () => (await saved(page)).tabs[0].recovery.state).toBe(outcome);
      await page.waitForTimeout(1100);
      expect(await calls(page)).toHaveLength(1);
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
    });
  }
  test('automatic recovery retains uncertain, malformed and legacy tabs without selecting history', async ({ page }) => {
    await seed(page, [{ reference: reference(1), state: 'attempting' },
      { reference: { ...reference(2), key: 'secret' }, state: 'eligible' }, undefined]);
    await expect.poll(async () => (await saved(page)).tabs[0].recovery.state).toBe('partial');
    expect((await saved(page)).tabs[1].recovery.state).toBe('unverified');
    await page.waitForTimeout(1200);
    expect(await calls(page)).toEqual([]);
    expect(JSON.stringify(await saved(page))).not.toContain('secret');
    for (const row of await page.locator('.runner-row .nav-row').all()) await row.click();
    await expect(page.locator('.runner-recovery')).toHaveCount(0);
  });
  test('automatic recovery captures confirmed starts, replaces interrupted process and retires completed work', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, recovery: true });
    await configure(page); await create(page);
    await page.evaluate(async () => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      window.__nativeFixture.sessions.get('pty-1').feature.observations.set('terminal:1', terminalWork(1, 1));
    });
    await expect.poll(async () => (await saved(page)).tabs[0].recovery?.state).toBe('eligible');
    const before = (await saved(page)).tabs[0];
    expect(before.recovery.reference.task_workload_id).toBe('work-pty-1');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect.poll(() => calls(page)).toHaveLength(1);
    expect((await calls(page))[0].reference).toEqual(before.recovery.reference);
    expect((await saved(page)).tabs[0].id).toBe(before.id);
    const owner = await page.evaluate(() => [...window.__nativeFixture.sessions.entries()]
      .find(([, s]) => s.recoveries?.some(r => r.operation === 'recovery.recover'))[0]);
    await page.evaluate(async owner => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      window.__nativeFixture.sessions.get(owner).feature.observations.set('terminal:1',
        terminalWork(1, 1, { state: 'succeeded', terminal: true, outcome: 'succeeded' }));
    }, owner);
    await expect.poll(async () => (await saved(page)).tabs[0].recovery).toBeUndefined();
  });
  test('intentional Hub teardown suppresses recovery but keeps tab identity', async ({ page }) => {
    await seed(page, [{ reference: reference(1), state: 'eligible' }]);
    await expect.poll(() => calls(page)).toHaveLength(1);
    const id = (await saved(page)).tabs[0].id;
    await page.reload();
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await page.waitForTimeout(1200);
    expect(await calls(page)).toEqual([]);
    expect((await saved(page)).tabs[0].id).toBe(id);
  });
  test('automatic recovery retires completion delivered only in the native exit snapshot', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, recovery: true });
    await configure(page); await create(page);
    await page.evaluate(async () => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      window.__nativeFixture.sessions.get('pty-1').feature.observations.set('terminal:1', terminalWork(1, 1));
    });
    await expect.poll(async () => (await saved(page)).tabs[0].recovery?.state).toBe('eligible');
    const before = await page.evaluate(() => {
      const f = window.__nativeFixture.sessions.get('pty-1').feature, invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const value = await invoke(command, args);
        if (command === 'runner_observe' && args.id === 'pty-1')
          value.features.results = value.features.results.filter(r => r.feature !== 'work');
        return value;
      };
      Object.assign(f.observations.get('terminal:1'), { event_id: 2, terminal: true, state: 'succeeded', outcome: 'succeeded' });
      return f.requests.length;
    });
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.length)).toBeGreaterThan(before);
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1, structuredClone(window.__nativeFixture.sessions.get('pty-1').control)));
    await expect.poll(async () => (await saved(page)).tabs[0].recovery).toBeUndefined();
    expect((await saved(page)).tabs[0].launchOnOpen).toBe(false);
    expect(await calls(page)).toEqual([]);
  });
  test('automatic recovery excludes normal Runner exit and explicit tab removal', async ({ page }) => {
    await seed(page, [1, 2].map(n => ({ reference: reference(n), state: 'eligible' })));
    await expect.poll(() => calls(page)).toHaveLength(2);
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 0));
    await expect.poll(async () => (await saved(page)).tabs[0].launchOnOpen).toBe(false);
    expect((await saved(page)).tabs[0].recovery).toBeUndefined();
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(page.locator('.quiet-status')).toContainText('Process exited (0)');
    await page.locator('.runner-row').nth(1).locator('.nav-row').click({ button: 'middle' });
    await page.getByRole('dialog').getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
    await expect(page.locator('.runner-row')).toHaveCount(1);
    expect((await saved(page)).tabs).toHaveLength(1);
    await page.waitForTimeout(1100);
    expect(await calls(page)).toHaveLength(2);
  });
  for (const theme of ['light', 'black']) for (const height of [650, 900]) {
    test('automatic recovery releases terminal height ' + theme + '/' + height, async ({ page }, info) => {
      await page.setViewportSize({ width: 1280, height });
      await seed(page, [{ reference: reference(1), state: 'eligible' }]);
      await page.locator('.runner-row .nav-row').click();
      if (theme === 'black') {
        await page.locator('.app-settings-trigger').click();
        await page.getByRole('button', { name: 'Black', exact: true }).click();
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
