export function registerRunnerTabRaces({ test, expect, transport, configure, create }) {
  const own = page => page.locator('.runner-row').filter({ has: page.getByText('Runner 1', { exact: true }) });
  const confirm = async page => {
    await own(page).locator('.remove-action').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
  };
  const reasons = ['execution', 'retained-task', 'suspension', 'foreground', 'native-unknown', 'stale',
    'reservation', 'draft', 'staged-attachment', 'restart-confirmation', 'termination-confirmation', 'account-setup', 'pending-prompt',
    'config-pending', 'config-draft', 'config-unknown', 'work-active', 'work-uncertain',
    'reference-unknown', 'reference-unverified', 'reference-inventory', 'input-unknown', 'native-exit-error'];
  for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
    test(`runner removal settings and hover focus ${language} ${theme}`, async ({ page }, info) => {
      await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
      await page.locator('.app-settings-trigger').click();
      const preference = page.getByRole('checkbox', { name: 'Confirm before removing Runner tab', exact: true });
      await expect(preference).toBeChecked();
      await preference.uncheck();
      await page.getByRole('button', { name: theme === 'light' ? 'Light' : 'Black', exact: true }).click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.keyboard.press('Escape');
      await own(page).hover();
      const rename = own(page).locator('.rename-action'), trash = own(page).locator('.remove-action');
      await expect(rename).toHaveCSS('opacity', '1'); await expect(trash).toHaveCSS('opacity', '1');
      expect((await trash.boundingBox()).x).toBeGreaterThan((await rename.boundingBox()).x);
      await page.mouse.move(900, 20); await own(page).locator('.nav-row').focus();
      await expect(trash).toHaveCSS('opacity', '1');
      await page.keyboard.press('Tab'); await expect(rename).toBeFocused();
      await page.keyboard.press('Tab'); await expect(trash).toBeFocused();
      await info.attach('sidebar-actions', { body: await page.screenshot({ path: info.outputPath('sidebar-actions.png') }), contentType: 'image/png' });
      await page.reload();
      await expect(own(page)).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).confirmRunnerRemoval)).toBe(false);
      await own(page).locator('.remove-action').click();
      await expect(own(page)).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.locator('.app-settings-trigger').click();
      const label = language === 'en' ? 'Confirm before removing Runner tab' : '러너 탭 제거 전 확인';
      await page.getByRole('checkbox', { name: label, exact: true }).check();
      await page.keyboard.press('Escape');
      await page.locator('.add-runner').click();
      await expect(page.locator('.runner-row')).toHaveCount(1);
      await page.locator('.runner-row .remove-action').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      if (language === 'ko') await expect(page.getByRole('dialog')).toContainText('러너를 종료합니다');
      await page.keyboard.press('Escape');
      await expect(page.locator('.runner-row')).toHaveCount(1);
    });
  }
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
test('runner removal retires tab before delayed close and isolates neighbor', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page); await create(page);
    await own(page).locator('.nav-row').click();
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('unsent draft');
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      window.__closeCalls = 0;
      native.invoke = async (command, args) => {
        if (command === 'pty_close' && args.id === 'pty-1') {
          window.__closeCalls++;
          await new Promise(resolve => { window.__releaseClose = resolve; });
        }
        return invoke(command, args);
      };
    });
    await confirm(page);
    await expect(own(page)).toHaveCount(0);
    await expect(page.locator('.runner-row .nav-row')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__closeCalls)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.evaluate(() => window.__releaseClose());
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
    await expect(page.locator('.single-entry')).toHaveAttribute('aria-current', 'page');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 99));
    await expect(page.locator('.termination-failures')).toHaveCount(0);
  });
  for (const reason of reasons) {
    test(`runner removal excludes unsafe ${reason} from reuse`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
      await page.evaluate(async reason => {
        const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
        const owner = window.__owner = new RunnerSessions();
        const { session, launched } = owner.create('/fixture/install');
        await launched; await session.control.fresh();
        const native = window.__nativeFixture.sessions.get(session.control.sessionId), o = native.control.observation;
        if (reason === 'execution') o.execution.owned_execution_alive = true;
        if (reason === 'retained-task') o.execution.workflow_kind = 'task';
        if (reason === 'suspension') o.attention.suspension_status = 'suspended';
        if (reason === 'foreground') o.attention.foreground_interaction_active = true;
        if (reason === 'reservation') session.reserve(Symbol('reserved'));
        if (reason === 'draft') session.setDraft('unsent draft');
        if (reason === 'staged-attachment') session.references.select(['/fixture/pending.txt']);
        if (reason === 'restart-confirmation') o.attention.restart_confirmation_required = true;
        if (reason === 'termination-confirmation') o.attention.termination_confirmation_active = true;
        if (reason === 'account-setup') o.attention.account_setup_required = true;
        if (reason === 'pending-prompt') o.attention.awaiting_user_command_reason = 'pending';
        if (reason === 'native-unknown') o.execution.lifecycle_state = 'UNRECOGNIZED';
        if (reason === 'stale') native.control.age = 10000;
        if (reason === 'config-pending') session.control.config.activity = 'planning';
        if (reason === 'config-draft') session.control.config.setDraft({ root: 'unapplied' });
        if (reason === 'config-unknown') session.control.config.applications.push({ verification: 'unknown' });
        if (reason === 'work-active' || reason === 'work-uncertain') {
          native.feature.mode = reason === 'work-active' ? 'started' : 'unknown';
          await session.control.work.submit('must retain this authority');
        }
        if (reason === 'reference-unknown') native.control.references.results.push({ id: 100, operation: 'references.register', state: 'outcome-unknown' });
        if (reason === 'reference-unverified') native.control.references.capability = null;
        if (reason === 'reference-inventory') native.items.push({ reference_id: 'a'.repeat(32), display_name: 'pending', kind: 'file' });
        if (reason === 'input-unknown') {
          window.__nativeFixture.failWrite(); session.setDraft('/status');
          try { await session.submit(); } catch {}
        }
        if (reason === 'native-exit-error') native.channel.onmessage({ type: 'exit', id: session.control.sessionId, code: 1, error: 'fixture ownership cleanup failed' });
        const id = session.view.id;
        if (!owner.close(id) || owner.get(id) || owner.close(id)) throw new Error('visible retirement failed');
      }, reason);
      if (reason === 'native-exit-error') {
        await expect.poll(() => page.evaluate(() => window.__owner.failures.length)).toBe(1);
        expect(await page.evaluate(() => window.__owner.failures[0].detail)).toBe('fixture ownership cleanup failed');
      } else await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
      expect(await page.evaluate(() => window.__owner.getSnapshot().length)).toBe(0);
      await page.evaluate(() => window.__owner.dispose());
    });
  }
  test('runner removal hidden idle allocation takes exact released session once and shutdown owns it', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = window.__owner = new RunnerSessions();
      const { session, launched } = owner.create('/fixture/install');
      await launched; await session.control.fresh(); await session.references.verifyAssignment();
      await new Promise(resolve => session.terminal.write('HIDDEN_HISTORY\r\n' + 'old line\r\n'.repeat(200), resolve));
      window.__original = session; window.__oldId = session.view.id;
      owner.close(session.view.id);
    });
    await expect.poll(() => page.evaluate(() => window.__original.reusableIdle)).toBe(true);
    const result = await page.evaluate(async () => {
      const owner = window.__owner, session = window.__original, old = window.__oldId;
      const first = owner.allocate('/fixture/install', Symbol('first'));
      const second = owner.allocate('/fixture/install', Symbol('second'));
      await second.launched;
      await new Promise(resolve => session.terminal.write('', resolve));
      const result = { exact: first.session === session, different: second.session !== session,
        noHistory: !Array.from({ length: session.terminal.buffer.active.length }, (_, i) =>
          session.terminal.buffer.active.getLine(i)?.translateToString()).join('\n').includes('HIDDEN_HISTORY'),
        newId: session.view.id !== old, orders: owner.getSnapshot().map(s => s.createdOrder),
        oldSelections: !!owner.getSelections(old), newSelections: !!owner.getSelections(session.view.id),
        count: window.__nativeFixture.count(), closed: [...window.__nativeFixture.closed],
        tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs.length };
      await owner.dispose(); return result;
    });
    expect(result).toEqual({ exact: true, different: true, noHistory: true, newId: true, orders: [2, 3],
      oldSelections: false, newSelections: true, count: 2, closed: [], tabs: 2 });
    expect(await page.evaluate(() => [...new Set(window.__nativeFixture.closed)].sort())).toEqual(['pty-1', 'pty-2']);
  });
  test('runner removal Single Entry reuse-idle presents hidden session as a new tab', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = window.__owner = new RunnerSessions({ allocationPolicy: 'reuse-idle' });
      const created = owner.create('/fixture/install'); await created.launched;
      await created.session.control.fresh(); window.__original = created.session;
      window.__oldId = created.session.view.id; owner.close(window.__oldId);
    });
    await expect.poll(() => page.evaluate(() => window.__original.reusableIdle)).toBe(true);
    const result = await page.evaluate(async () => {
      const owner = window.__owner; owner.entry.setDraft('/status'); await owner.entry.submit('/fixture/install');
      const result = { phase: owner.entry.phase, same: owner.get(owner.entry.runnerId) === window.__original,
        newId: owner.entry.runnerId !== window.__oldId, count: window.__nativeFixture.count() };
      await owner.dispose(); return result;
    });
    expect(result).toEqual({ phase: 'delivered', same: true, newId: true, count: 1 });
  });
  for (const mode of ['failed', 'unconfirmed']) {
    test(`runner removal ${mode} termination reopens original full log without launching`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page); await create(page);
      await own(page).locator('.nav-row').click();
      await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('unsent');
      await page.evaluate(mode => {
        window.__nativeFixture.emit('pty-1', '\r\nORIGINAL_SCROLLBACK\r\n' + Array.from({ length: 300 }, (_, i) => 'row ' + i).join('\r\n'));
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        native.invoke = (command, args) => command === 'pty_close' && args.id === 'pty-1'
          ? mode === 'failed' ? Promise.reject(new Error('fixture exact termination failed')) : Promise.resolve()
          : invoke(command, args);
      }, mode);
      await confirm(page);
      await expect(own(page)).toHaveCount(0);
      await expect(page.locator('.termination-failures')).toBeVisible({ timeout: 15000 });
      const before = await page.evaluate(() => window.__nativeFixture.count());
      await page.locator('.termination-failures button').click();
      await expect(page.getByRole('alert').filter({ hasText: mode === 'failed' ? 'fixture exact termination failed' : 'unconfirmed' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Search terminal', exact: true }).fill('ORIGINAL_SCROLLBACK');
      await page.getByRole('button', { name: 'Previous', exact: true }).click();
      await expect(page.locator('.xterm-rows')).toContainText('ORIGINAL_SCROLLBACK');
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(before);
      await page.locator('.runner-row .nav-row').click();
      await expect(page.getByText('Process running', { exact: true })).toBeVisible();
      await page.evaluate(() => window.__nativeFixture.exit('pty-1', 0));
      await expect(page.locator('.termination-failures')).toHaveCount(0);
      await expect(page.locator('.runner-row .nav-row')).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs.length)).toBe(1);
      await page.reload();
      await expect(page.locator('.runner-row')).toHaveCount(1);
      await expect(page.locator('.runner-row')).toContainText('Runner 2');
    });
  }
}
