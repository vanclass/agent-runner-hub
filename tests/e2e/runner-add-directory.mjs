export function registerRunnerAddDirectory({ test, expect, transport, configure, create }) {
  const add = page => page.locator('.add-runner');
  const root = page => page.locator('.task-panel .directory-field');
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  async function ready(page) {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
  }
  async function picker(page) {
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      const state = window.__directoryPicker = { calls: 0, resolves: 0, mode: 'selected' };
      native.invoke = async (command, args) => {
        if (command === 'runner_resolve') state.resolves++;
        if (command !== 'plugin:dialog|open') return invoke(command, args);
        state.calls++;
        if (!args.options.directory || args.options.multiple) throw new Error('Expected one native directory');
        if (state.mode === 'cancel') return null;
        if (state.mode === 'error') throw new Error('fixture picker unavailable');
        if (state.mode === 'delayed') return new Promise((resolve, reject) => { state.finish = resolve; state.fail = reject; });
        return '/fixture/chosen folder';
      };
    });
  }
  async function delayed(page, field) {
    await page.evaluate(() => { window.__directoryPicker.mode = 'delayed'; });
    await field.locator('button').click();
    await expect(field.locator('button')).toHaveAttribute('aria-busy', 'true');
  }
  test('add directory: manual promotion retains native output, appends once and shares Single Entry order', async ({ page }, info) => {
    await ready(page);
    await expect(page.locator('.toolbar .new-runner')).toHaveCount(0);
    await expect(page.locator('.runner-row')).toHaveCount(0);
    await add(page).evaluate(button => { button.click(); button.click(); });
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await expect(page.locator('.runner-row .nav-row')).toBeFocused();
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(2);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await home(page);
    await expect(page.locator('.spare-status')).toHaveCount(0);
    await create(page);
    await expect(page.locator('.xterm-rows')).toContainText('pty-2: 안녕 🌍');
    await home(page);
    await expect(page.locator('.spare-status')).toHaveCount(0);
    await page.getByLabel('Single Entry instructions', { exact: true }).fill('same append order');
    await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
    await expect(page.locator('.runner-name')).toHaveText(['Runner 1', 'Runner 2', 'Runner 3']);
    await expect(page.locator('.runner-list > li').last()).toHaveClass('add-runner-row');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs);
    expect(saved.map(tab => tab.createdOrder)).toEqual([1, 2, 3]);
    expect(saved.map(tab => tab.name)).toEqual(['Runner 1', 'Runner 2', 'Runner 3']);
    await info.attach('green-add-tab', { body: await page.screenshot(), contentType: 'image/png' });
    await page.reload();
    await expect(page.locator('.runner-name')).toHaveText(['Runner 1', 'Runner 2', 'Runner 3']);
    await expect(page.locator('.runner-list > li').last()).toHaveClass('add-runner-row');
  });
  test('add directory: fallback launch is single flight and a failed launch has one honest diagnostic tab', async ({ page }) => {
    await transport(page); await configure(page);
    await page.evaluate(() => {
      const f = window.__nativeFixture;
      f.sessions.get('pty-1').control.state = 'disconnected';
      f.failNext();
    });
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed.includes('pty-1'))).toBe(true);
    await add(page).evaluate(button => { button.click(); button.click(); });
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await expect(page.getByRole('alert').filter({ hasText: 'fixture process launch failed' })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
    await add(page).click();
    await expect(page.locator('.runner-row')).toHaveCount(2);
    await expect(page.getByText('Process running', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(3);
    await expect(page.locator('.runner-list > li').last()).toHaveClass('add-runner-row');
  });
  for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
    test(`add directory: accessible green plus and three directory fields ${language} ${theme}`, async ({ page }, info) => {
      await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
      await expect(add(page)).toBeVisible(); await expect(add(page)).toBeDisabled();
      await page.getByLabel('AgentRunner location', { exact: true }).fill('/fixture/install');
      await page.getByRole('button', { name: 'Verify and Start', exact: true }).click();
      await expect(page.locator('.spare-status')).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
      await page.getByLabel('Requested Run Mode', { exact: true }).selectOption({ label: 'direct-run' });
      await picker(page);
      await page.getByRole('button', { name: 'App settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.getByRole('button', { name: language === 'en' ? (theme === 'light' ? 'Light' : 'Black') : (theme === 'light' ? '라이트' : '블랙'), exact: true }).click();
      await expect(add(page)).toHaveAccessibleName(language === 'en' ? 'New Runner' : '새 Runner');
      const shape = await add(page).evaluate(button => {
        const box = button.getBoundingClientRect(), plus = button.firstElementChild.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { height: box.height, size: parseFloat(style.fontSize), background: style.backgroundColor,
          dx: Math.abs(box.x + box.width / 2 - plus.x - plus.width / 2),
          dy: Math.abs(box.y + box.height / 2 - plus.y - plus.height / 2) };
      });
      expect(shape.height).toBeGreaterThanOrEqual(44); expect(shape.size).toBeGreaterThanOrEqual(28);
      expect(shape.dx).toBeLessThan(1); expect(shape.dy).toBeLessThan(1);
      expect(shape.background).toBe(theme === 'light' ? 'rgb(214, 239, 223)' : 'rgb(25, 59, 41)');
      const fields = page.locator('dialog .directory-field');
      await expect(fields).toHaveCount(1);
      await fields.first().locator('button').click();
      await expect(fields.first().locator('input')).toHaveValue('/fixture/chosen folder');
      await page.keyboard.press('Escape');
      await root(page).locator('button').click();
      await expect(root(page).locator('input')).toHaveValue('/fixture/chosen folder');
      expect(await page.evaluate(() => window.__directoryPicker.resolves)).toBe(0);
      await root(page).locator('input').fill('/fixture/install');
      await root(page).locator('button').click();
      await expect(add(page)).toBeEnabled();
      await page.getByRole('navigation').locator('.single-entry').focus();
      await page.keyboard.press('End'); await expect(add(page)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.runner-row')).toHaveCount(1);
      const runMode = page.getByRole('combobox', { name: language === 'en' ? 'Requested Run Mode' : '요청 실행 모드', exact: true });
      await runMode.focus();
      await expect(runMode).toBeEnabled();
      await runMode.selectOption({ label: 'pure-direct-run' });
      await root(page).locator('button').click();
      await expect(root(page).locator('input')).toHaveValue('/fixture/chosen folder');
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature?.requests ?? []).filter(r => /session_config\.(plan|apply)$/.test(r.operation)).length)).toBe(0);
      await info.attach(`directory-fields-${language}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
  test('add directory: installation typing cancellation errors and delayed unmounted picker preserve paths', async ({ page }) => {
    await ready(page); await picker(page);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const field = page.locator('.runner-location .directory-field'), input = field.locator('input');
    await input.fill('/manual paste');
    await page.evaluate(() => { window.__directoryPicker.mode = 'cancel'; }); await field.locator('button').click();
    await expect(input).toHaveValue('/manual paste');
    await page.evaluate(() => { window.__directoryPicker.mode = 'error'; }); await field.locator('button').click();
    await expect(field.getByRole('alert')).toContainText('fixture picker unavailable');
    await expect(input).toHaveValue('/manual paste');
    await delayed(page, field); await input.fill('/newer draft');
    await page.evaluate(() => window.__directoryPicker.finish('/stale')); await expect(input).toHaveValue('/newer draft');
    await page.getByRole('button', { name: 'Verify installation', exact: true }).click();
    await expect(add(page)).toBeEnabled();
    await delayed(page, field); await page.keyboard.press('Escape');
    await page.evaluate(() => window.__directoryPicker.finish('/wrong tab'));
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await expect(page.locator('.runner-location input')).toHaveValue('/fixture/install');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('/wrong tab');
  });
  test('add directory: Single Entry and configuration pickers discard newer drafts tab switches and process exit', async ({ page }) => {
    await ready(page); await picker(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByLabel('Requested Run Mode', { exact: true }).selectOption({ label: 'direct-run' });
    await root(page).locator('input').fill('/entry original');
    await delayed(page, root(page));
    await page.getByLabel('Requested Run Mode', { exact: true }).selectOption({ label: 'pure-direct-run' });
    await page.evaluate(() => window.__directoryPicker.finish('/stale mode'));
    await expect(root(page).locator('input')).toHaveValue('/entry original');
    await create(page);
    await page.getByLabel('Requested Run Mode', { exact: true }).focus();
    await page.getByLabel('Requested Run Mode', { exact: true }).selectOption({ label: 'direct-run' });
    await root(page).locator('input').fill('/config original');
    await delayed(page, root(page));
    await root(page).locator('input').fill('/config newer');
    await page.evaluate(() => window.__directoryPicker.finish('/stale typed'));
    await expect(root(page).locator('input')).toHaveValue('/config newer');
    await delayed(page, root(page)); await home(page);
    await page.evaluate(() => window.__directoryPicker.fail(new Error('late wrong-tab error')));
    await expect(root(page).locator('input')).toHaveValue('/entry original');
    await expect(page.getByRole('alert').filter({ hasText: 'late wrong-tab error' })).toHaveCount(0);
    await page.locator('.runner-row .nav-row').click();
    await expect(root(page).locator('input')).toHaveValue('/config newer');
    await delayed(page, root(page));
    await page.evaluate(() => { const f = window.__nativeFixture; f.exit('pty-1', 0, f.sessions.get('pty-1').control); window.__directoryPicker.finish('/ended'); });
    await expect(root(page).locator('input')).toHaveValue('/config newer');
  });
}
