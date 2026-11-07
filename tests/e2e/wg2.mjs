export function registerWG2({ test, expect, transport, configure }) {
  for (const display of ['unified', 'run-mode']) for (const scenario of ['always-new', 'reuse-idle', 'reuse-same-mode', 'missing', 'busy']) {
    test(`WG2 allocation ${scenario} with ${display} display`, async ({ page }) => {
      await transport(page, undefined, { work: true, auto: true }); await page.goto('/');
      const result = await page.evaluate(async ({ display, scenario }) => {
        const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
        const owner = new RunnerSessions({ allocationPolicy: ['missing', 'busy'].includes(scenario) ? 'reuse-same-mode' : scenario,
          runMode: 'task-run', accountIdentity: { agent_id: 'codex', profile_name: 'first' } });
        const issue = owner.create('/fixture/install'); await issue.launched;
        const task = owner.create('/fixture/install'); await task.launched;
        await Promise.all([issue.session.control.fresh(), task.session.control.fresh()]);
        if (!issue.session.assignmentAvailable || !task.session.assignmentAvailable)
          throw Error('fixture candidates not ready');
        owner.navigation.intent(issue.session.view.id, 'issue-run');
        owner.navigation.intent(task.session.view.id, scenario === 'missing' ? 'issue-run' : 'task-run');
        owner.navigation.project(owner.getSnapshot(), display);
        const token = Symbol('busy fixture');
        if (scenario === 'busy' && !task.session.reserve(token)) throw Error('fixture reservation failed');
        const before = [issue.session, task.session].map(s => JSON.stringify(s.control.config.actual));
        owner.entry.setDraft('WG2 once'); await owner.entry.submit('/fixture/install');
        const selected = owner.entry.runnerId;
        const result = { phase: owner.entry.phase, detail: owner.entry.detail,
          selected: selected === issue.session.view.id ? 'issue' : selected === task.session.view.id ? 'task' : 'new',
          unchanged: [issue.session, task.session].every((s, i) => s.view.id === selected || JSON.stringify(s.control.config.actual) === before[i]),
          submits: [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests).filter(r => r.operation === 'work.submit').length };
        if (scenario === 'busy') task.session.release(token);
        await owner.dispose(); return result;
      }, { display, scenario });
      expect(result.phase, JSON.stringify(result.detail)).toBe('delivered');
      expect(result.selected).toBe(scenario === 'reuse-idle' ? 'issue' : scenario === 'reuse-same-mode' ? 'task' : 'new');
      expect(result.unchanged).toBe(true); expect(result.submits).toBe(1);
    });
  }
  for (const theme of ['Light', 'Black']) test(`WG2 ${theme} rendered persistence and account rejection`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true }); await configure(page);
    const account = page.getByRole('combobox', { name: 'Requested Account', exact: true });
    await expect(account).toBeEnabled();
    await expect(account.getByRole('option', { name: 'Select an account', exact: true })).toBeAttached();
    await account.selectOption('');
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    const policy = page.getByRole('combobox', { name: 'Runner allocation policy', exact: true });
    await expect(policy.locator('option')).toHaveText(['Always create a new Runner', 'Reuse idle Runner in the same Run Mode', 'Reuse any idle Runner']);
    await policy.selectOption('reuse-same-mode');
    await info.attach(`${theme}-allocation`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape'); await page.reload();
    await expect(account.getByRole('option', { name: 'codex / first', exact: true })).toBeAttached();
    await expect(account).toBeEnabled(); await expect(account).toHaveValue('');
    await expect(page.getByText('Runner control channel is not ready', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh available choices' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('unresolved account');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Release unsent assignment', exact: true })).toBeVisible();
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests).filter(r => r.operation === 'work.submit').length)).toBe(0);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await expect(policy).toHaveValue('reuse-same-mode'); await expect(policy).toBeDisabled();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
    await expect(page.getByRole('combobox', { name: '러너 배정 방식', exact: true }).locator('option')).toHaveText(['항상 새 러너 생성', '동일 실행 모드에서 유휴 러너 재사용', '실행 모드 무관하게 유휴 러너 재사용']);
    await info.attach(`${theme}-korean-locked`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
