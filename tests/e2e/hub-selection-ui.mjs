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
    await expect(page.locator('.hub-activity')).toContainText('Select a project or target.');
    await expect(page.locator('.task-panel [role="status"]')).toHaveCount(0);
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
  test('authenticated startup Provider observations refresh both settings surfaces', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await page.addInitScript(() => {
      window.__startupProvider = 'codex';
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command === 'runner_observe' && result.observation)
          result.observation.configured_startup_agent_id = window.__startupProvider;
        return result;
      };
    });
    await configure(page);
    const account = page.locator('.account-settings');
    await expect(account).toContainText('Effective Provider: Codex');
    await expect(account).toContainText('Configured Startup Provider: Codex');
    await page.evaluate(() => { window.__startupProvider = 'claude'; });
    await expect(account).toContainText('Configured Startup Provider: Claude');
    await expect(account).toContainText('Effective Provider: Codex');
    await page.evaluate(() => { window.__startupProvider = 'codex'; });
    await create(page);
    await expect(account).toContainText('Configured Startup Provider: Codex');
    for (const [value, label] of [['claude', 'Claude'], ['none', 'None'],
      [undefined, 'Unavailable'], ['codex', 'Codex'], [null, 'Unavailable'],
      ['claude', 'Claude'], ['unsupported', 'Unavailable']]) {
      await page.evaluate(v => { window.__startupProvider = v; }, value);
      await expect(account).toContainText(`Configured Startup Provider: ${label}`);
      await expect(account).toContainText('Effective Provider: Codex');
    }
    await expect(requested(page, 'Model')).toHaveValue(/"agent_id":"codex"/);
  });
  test('a fresh Claude tab offers only Claude choices and preserves independent selections', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command === 'pty_open' && result !== 'pty-1') {
          const config = window.__nativeFixture.sessions.get(result).feature.config;
          config.current.account = config.accounts.find(a => a.agent_id === 'claude');
        }
        return result;
      };
    });
    await configure(page);
    await expect(requested(page, 'Model')).toHaveValue(/"agent_id":"codex"/);
    await page.getByRole('checkbox', { name: 'Fast', exact: true }).check();
    await create(page);
    await create(page);
    await expect(page.locator('.account-settings')).toContainText('Effective Provider: Claude');
    await expect(page.locator('.account-settings')).toContainText('Configured Startup Provider: Unavailable');
    await expect(requested(page, 'Account').getByRole('option', { name: 'claude / first', exact: true })).toBeAttached();
    await expect(requested(page, 'Account').getByRole('option', { name: 'codex / second', exact: true })).toHaveCount(0);
    await expect(requested(page, 'Model')).toHaveValue(/"agent_id":"claude"/);
    await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).not.toBeChecked();
    await requested(page, 'Account').selectOption({ label: 'claude / first' });
    await requested(page, 'Model').selectOption({ label: 'm0', exact: true });
    await expect(requested(page, 'Model')).toHaveValue(/"agent_id":"claude"/);
    await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(requested(page, 'Model')).toHaveValue(/"agent_id":"claude"/);
    await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).not.toBeChecked();
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(page.locator('.account-settings')).toContainText('Effective Provider: Codex');
    await expect(requested(page, 'Model')).toHaveValue(/"agent_id":"codex"/);
  });
  test('a retained tab refreshes Provider choices and remembers explicit preferences by Provider', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await create(page);
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    await page.getByRole('checkbox', { name: 'Fast', exact: true }).check();
    await create(page);
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    const account = page.locator('.account-settings');
    const switchTo = provider => page.evaluate(provider => {
      const session = window.__nativeFixture.sessions.get('pty-2');
      const c = session.feature.config;
      c.current.account = c.accounts.find(a => a.agent_id === provider) ?? { agent_id: provider, profile_name: '' };
      c.current.model = { id: provider === 'claude' ? 'm1' : 'm0', reasoning_effort: 'high' };
      session.control.observation.configured_startup_agent_id = 'codex';
    }, provider);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await switchTo('claude');
    await expect(account).toContainText('Effective Provider: Claude');
    await expect(account).toContainText('Configured Startup Provider: Codex');
    await expect(requested(page, 'Model')).toHaveValue(/m1/);
    await expect(requested(page, 'Reasoning effort')).toHaveValue('high');
    await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).toBeDisabled();
    await requested(page, 'Reasoning effort').selectOption('medium');
    await switchTo('none');
    await expect(account).toContainText('Effective Provider: None');
    await expect(requested(page, 'Model').locator('option')).toHaveCount(1);
    await expect(requested(page, 'Account').locator('option')).toHaveCount(1);
    await switchTo('codex');
    await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).toBeChecked();
    await switchTo('claude');
    await expect(requested(page, 'Reasoning effort')).toHaveValue('medium');
    await page.locator('.runner-row').last().locator('.nav-row').click();
    await expect(account).toContainText('Effective Provider: Codex');
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
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
    expect(initial).toEqual({ initialized: true, providerPreferences: {}, target: { binding_state: 'bound', owner: 'Workspace', project: '' },
      accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run',
      model: { model: 'm0', reasoning_effort: 'medium', service_tier: 'default', agent_id: 'codex' } });
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
