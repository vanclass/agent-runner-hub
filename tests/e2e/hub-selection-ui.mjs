export function registerHubSelectionUI({ test, expect, transport, configure, create }) {
  const key = 'agent-runner-hub.preferences.v1';
  const requested = (page, field) => page.getByRole('combobox', { name: `Requested ${field}`, exact: true });
  test('new unbound native session retains complete candidates without repeated inspection', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command === 'pty_open') window.__nativeFixture.sessions.get(result).feature.config.current.target = '';
        if (command === 'runner_observe') result.observation.target = { binding_state: 'unset', owner: '', project: '' };
        return result;
      };
    });
    await configure(page);
    await expect(requested(page, 'Account').getByRole('option', { name: 'codex / first', exact: true })).toBeAttached();
    await expect(requested(page, 'Account')).toBeEnabled();
    const count = () => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests.length);
    const settled = await count();
    await page.waitForTimeout(1000);
    expect(await count()).toBe(settled);
    await requested(page, 'Project / Target').selectOption({ label: 'Exact' });
    await requested(page, 'Account').selectOption({ label: 'codex / first' });
    await expect(requested(page, 'Account')).toBeEnabled();
    await requested(page, 'Model').selectOption({ label: 'm0' });
    await requested(page, 'Run Mode').selectOption({ label: 'Issue Run' });
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
      s.feature.requests.every(r => r.operation !== 'work.submit')
      && s.feature.config.requests.every(r => r.operation === 'session_config.inspect')))).toBe(true);
  });
  test('pending Hub initialization preserves the allocation policy edit', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = (command, args) => {
        if (command === 'runner_feature' && args.request.feature === 'session_config')
          window.__nativeFixture.sessions.get(args.id).feature.config.hold = true;
        return invoke(command, args);
      };
      window.__releaseInspection = () => { native.invoke = invoke; };
    });
    await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
    await page.getByRole('button', { name: 'Verify and Start', exact: true }).click();
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()]
      .some(s => s.feature?.config.requests.length > 0))).toBe(true);

    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Runner allocation policy', exact: true }).selectOption('reuse-idle');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__releaseInspection();
      for (const s of window.__nativeFixture.sessions.values()) { s.feature.config.hold = false; s.feature.config.complete(); }
    });
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Runner allocation policy', exact: true })).toHaveValue('reuse-idle');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).singleEntry.allocationPolicy, key)).toBe('reuse-idle');
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
      s.feature.requests.length === 0 && s.feature.config.requests.every(r => r.operation === 'session_config.inspect')))).toBe(true);
  });
  test('Hub selections automatically load fresh and restored independent tab catalogs', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await expect(requested(page, 'Model').getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    const initial = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).singleEntry, key);
    expect(initial).toEqual({ initialized: true, target: { binding_state: 'bound', owner: 'Workspace', project: '' },
      accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run',
      model: { model: 'm0', reasoning_effort: 'medium', service_tier: 'default' } });
    await expect(page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh available choices' })).toHaveCount(0);
    await create(page);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).focus();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await requested(page, 'Model').selectOption({ label: 'm2' });
    await create(page);
    await expect(requested(page, 'Model')).toHaveValue(/m2/);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toHaveValue(JSON.stringify('issue-run'));
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    expect(Object.values(saved.runnerSelections).map(v => v.model.model)).toEqual(['m0', 'm2']);
    const noEffects = await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
      !s.feature.requests.some(r => r.operation === 'work.submit')
      && s.feature.config.requests.every(r => r.operation === 'session_config.inspect')));
    expect(noEffects).toBe(true);
    await page.reload();
    await expect(requested(page, 'Model')).toHaveValue(/m2/);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()]
      .flatMap(s => s.feature.config.requests).length)).toBeGreaterThan(0);
    await requested(page, 'Model').focus();
    await expect(requested(page, 'Model').getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await expect(requested(page, 'Model')).toHaveValue(/m2/);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(saved);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toHaveValue(JSON.stringify('issue-run'));
    await info.attach('restored-independent-Hub-selections', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
