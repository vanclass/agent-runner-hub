export function registerRunnerTabRaces({ test, expect, transport, configure, create }) {
  const own = page => page.locator('.runner-row').filter({ has: page.getByText('Runner 1', { exact: true }) });
  const middle = page => own(page).locator('.nav-row').click({ button: 'middle' });
  const confirm = async page => {
    await page.getByRole('button', { name: 'Close Tab', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
  };
  const reasons = ['execution', 'retained-task', 'suspension', 'foreground', 'native-unknown', 'stale',
    'config-pending', 'config-draft', 'config-unknown', 'reference-unknown', 'reference-unverified', 'reference-inventory', 'input-unknown', 'native-exit-error'];
  test('background work read-only status survives configuration uncertainty without admitting another submission', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
    await page.clock.install();
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = window.__statusOwner = new RunnerSessions(), created = owner.create('/fixture/install');
      await created.launched; await created.session.control.fresh();
      await created.session.control.work.submit('original');
      created.session.control.config.applications.push({ verification: 'unknown' });
      window.__nativeFixture.sessions.get('pty-1').feature.mode = 'succeeded';
    });
    await page.clock.runFor(1600);
    const result = await page.evaluate(async () => {
      const owner = window.__statusOwner, session = owner.get(owner.getSnapshot()[0].id);
      const result = { activity: session.control.work.activity, uncertain: session.control.config.uncertain,
        submissions: window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length };
      await owner.dispose(); return result;
    });
    expect(result).toEqual({ activity: 'completed', uncertain: true, submissions: 1 });
  });
  test('runner tab starting native ownership cannot be middle-closed', async ({ page }) => {
    await transport(page); await page.goto('/');
    const result = await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = new RunnerSessions(), created = owner.create('/fixture/install');
      const admitted = await owner.close(created.session.view.id, 'middle');
      const closed = [...window.__nativeFixture.closed];
      await created.launched; await owner.dispose(); return { admitted, closed };
    });
    expect(result).toEqual({ admitted: false, closed: [] });
  });
  test('runner tab failed close followed by verified native exit permits settled removal', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = (command, args) => command === 'pty_close' && args.id === 'pty-2'
        ? Promise.reject(new Error('fixture failed close before native exit')) : invoke(command, args);
    });
    await confirm(page);
    await expect(page.getByRole('alert').filter({ hasText: 'fixture failed close before native exit' })).toBeVisible();
    await middle(page);
    await expect(own(page)).toBeVisible();
    await page.evaluate(() => window.__nativeFixture.exit('pty-2', 0));
    await middle(page);
    await expect(own(page)).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toEqual([]);
  });
  test('runner tab middle-click during rename does not select rename or close twice', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page); await create(page);
    await own(page).locator('.nav-row').dblclick();
    const editor = page.locator('.rename-row input');
    await editor.click({ button: 'middle' });
    await expect(editor).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await editor.press('Escape');
    await page.locator('.runner-row').filter({ has: page.getByText('Runner 2', { exact: true }) }).locator('.nav-row').dblclick({ button: 'middle' });
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runner 1');
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-3']);
    await expect(page.locator('.rename-row input')).toHaveCount(0);
  });
  for (const reason of reasons) {
    test(`runner tab admission rejects ${reason}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
      const result = await page.evaluate(async reason => {
        const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
        const owner = new RunnerSessions();
        const { session, launched } = owner.create('/fixture/install');
        await launched; await session.control.fresh();
        const native = window.__nativeFixture.sessions.get(session.control.sessionId), o = native.control.observation;
        if (reason === 'execution') o.execution.owned_execution_alive = true;
        if (reason === 'retained-task') o.execution.workflow_kind = 'task';
        if (reason === 'suspension') o.attention.suspension_status = 'suspended';
        if (reason === 'foreground') o.attention.foreground_interaction_active = true;
        if (reason === 'native-unknown') o.execution.lifecycle_state = 'UNRECOGNIZED';
        if (reason === 'stale') native.control.age = 10000;
        if (reason === 'config-pending') session.control.config.activity = 'planning';
        if (reason === 'config-draft') session.control.config.setDraft({ root: 'unapplied' });
        if (reason === 'config-unknown') session.control.config.applications.push({ verification: 'unknown' });
        if (reason === 'reference-unknown') native.control.references.results.push({ id: 100, operation: 'references.register', state: 'outcome-unknown' });
        if (reason === 'reference-unverified') native.control.references.capability = null;
        if (reason === 'reference-inventory') native.items.push({ reference_id: 'a'.repeat(32), display_name: 'pending', kind: 'file' });
        if (reason === 'input-unknown') {
          window.__nativeFixture.failWrite(); session.setDraft('/status');
          try { await session.submit(); } catch {}
        }
        await session.control.fresh().catch(() => {});
        if (reason === 'native-exit-error') native.channel.onmessage({ type: 'exit', id: session.control.sessionId, code: 1, error: 'fixture ownership cleanup failed' });
        const admitted = await owner.close(session.view.id, 'middle');
        const evidence = { admitted, retained: owner.get(session.view.id) === session, closed: [...window.__nativeFixture.closed],
          detail: session.view.detail, activity: session.tabView.activity };
        await owner.dispose(); return evidence;
      }, reason);
      expect(result.admitted).toBe(false); expect(result.retained).toBe(true); expect(result.closed).toEqual([]);
      if (reason === 'native-unknown') expect(result.activity).toBe('unknown');
    });
  }
  test('runner tab close failure is observable and leaves exact row plus neighbor and spare independent', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page); await create(page);
    await own(page).locator('.nav-row').click();
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'pty_close' && args.id === 'pty-2') throw new Error('fixture exact termination failed');
        return invoke(command, args);
      };
    });
    await confirm(page);
    await expect(page.getByRole('alert').filter({ hasText: 'fixture exact termination failed' })).toBeVisible();
    await expect(own(page)).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toHaveLength(2);
    await page.locator('.runner-row').filter({ has: page.getByText('Runner 2', { exact: true }) }).locator('.nav-row').click();
    await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  });
  test('runner tab close joins exit and acknowledgment, fences duplicate and stale callbacks, preserves new selection', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page); await create(page);
    await own(page).locator('.nav-row').click();
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      window.__closeCalls = 0;
      native.invoke = async (command, args) => {
        if (command === 'pty_close' && args.id === 'pty-2') {
          window.__closeCalls++;
          await new Promise(resolve => { window.__releaseClose = resolve; });
          return;
        }
        return invoke(command, args);
      };
    });
    await confirm(page);
    await expect(page.getByRole('status').filter({ hasText: 'Closing Runner tab' })).toBeVisible();
    await page.evaluate(() => window.__nativeFixture.exit('pty-2', 0));
    await expect(own(page)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toHaveLength(2);
    await middle(page);
    await page.locator('.runner-row').filter({ has: page.getByText('Runner 2', { exact: true }) }).locator('.nav-row').click();
    await page.evaluate(() => window.__releaseClose());
    await expect(own(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runner 2');
    expect(await page.evaluate(() => window.__closeCalls)).toBe(1);
    await page.evaluate(() => { window.__nativeFixture.exit('pty-2', 99); window.__nativeFixture.emit('pty-2', 'late stale output'); });
    await expect(page.getByText('Process running', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toHaveLength(1);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').control.state)).toBe('ready');
  });
  test('runner tab unconfirmed close acknowledgment retains tab until exact native exit is settled', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = (command, args) => command === 'pty_close' && args.id === 'pty-2' ? Promise.resolve() : invoke(command, args);
    });
    await page.clock.install();
    await confirm(page);
    await page.clock.runFor(10100);
    await expect(page.getByRole('alert').filter({ hasText: 'Native cleanup is unconfirmed' })).toBeVisible();
    await expect(own(page)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toHaveLength(1);
    await middle(page);
    await expect(own(page)).toBeVisible();
    await page.evaluate(() => window.__nativeFixture.exit('pty-2', 0));
    await middle(page);
    await expect(own(page)).toHaveCount(0);
  });
}
