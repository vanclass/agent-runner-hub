export function registerInstallationSetup({ test, expect, transport, configure, create }) {
  const dialog = page => page.getByRole('dialog');
  const settings = page => page.getByRole('button', { name: 'App settings', exact: true }).click();
  for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
    test(`installation setup: mandatory accessible layout ${language} ${theme}`, async ({ page }, info) => {
      await transport(page);
      await page.goto('/');
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.getByRole('button', { name: language === 'en' ? (theme === 'light' ? 'Light' : 'Black') : (theme === 'light' ? '라이트' : '블랙'), exact: true }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).locator('input')).toHaveValue('');
      await expect(dialog(page).locator('button[type=submit]')).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(dialog(page)).toBeVisible();
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(0);
      for (const width of [1000, 540, 360]) {
        await page.setViewportSize({ width, height: 640 });
        const box = await dialog(page).boundingBox();
        expect(box.width).toBeLessThanOrEqual(500);
        expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
        await expect(dialog(page).locator('button[type=submit]')).toBeInViewport();
        await dialog(page).locator('input').focus();
        for (let i = 0; i < 8; ++i) {
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);
        }
        await info.attach(`setup-${language}-${theme}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
      await dialog(page).locator('input').fill('/missing');
      await dialog(page).locator('button[type=submit]').click();
      await expect(dialog(page).getByRole('alert')).toContainText('managed Python');
      expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(0);
      await dialog(page).locator('input').fill('/fixture/workspace/agent_runner');
      await dialog(page).locator('input').press('Enter');
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.locator('.single-entry')).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.installation'))).toBe('/fixture/install');
      await expect(page.locator('.output .runner-location')).toHaveCount(0);
    });
  }
  test('installation setup: browser preview reports native requirement without invoking missing runtime', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const originalFailure = await page.evaluate(async () => {
      try { await (await import('/node_modules/@tauri-apps/plugin-dialog/dist-js/index.js')).open({ directory: true }); }
      catch (reason) { return String(reason); }
    });
    expect(originalFailure).toContain("Cannot read properties of undefined (reading 'invoke')");
    await dialog(page).locator('input').fill('C:\\manual paste');
    await dialog(page).getByRole('button', { name: 'Browse for AgentRunner location', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('Tauri desktop Hub');
    await expect(dialog(page).locator('input')).toHaveValue('C:\\manual paste');
    await dialog(page).locator('button[type=submit]').click();
    await expect(dialog(page).getByRole('alert').last()).toContainText('run.cmd');
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
    await expect(dialog(page).getByRole('alert').last()).toContainText('데스크톱');
    expect(errors).toEqual([]);
  });
  test('installation setup: pending saved verification blocks restoration then starts each owner once', async ({ page }) => {
    await transport(page);
    await page.addInitScript(() => {
      localStorage.setItem('agent-runner-hub.installation', '/fixture/install');
      localStorage.setItem('agent-runner-hub.workspace.v1', JSON.stringify({ version: 1, tabs: [
        { id: '12345678-1234-1234-1234-123456789abc', createdOrder: 4, name: 'Retained Runner', installationRoot: '/fixture/other', launchOnOpen: true }
      ] }));
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      const gate = new Promise(resolve => { window.__finishInstallation = resolve; });
      native.invoke = async (command, args) => {
        if (command === 'runner_resolve') await gate;
        return invoke(command, args);
      };
    });
    await page.goto('/');
    await expect(dialog(page).getByRole('status')).toContainText('Verifying');
    await expect(dialog(page).locator('input')).toBeDisabled();
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0].name)).toBe('Retained Runner');
    await page.evaluate(() => window.__finishInstallation());
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.runner-name')).toHaveText(['Retained Runner']);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(2);
    await expect(page.locator('.single-entry')).toHaveAttribute('aria-current', 'page');
    const tabs = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs);
    expect(tabs[0].installationRoot).toBe('/fixture/other');
  });
  test('installation setup: later changes preserve tabs and failed drafts, valid restart bypasses setup', async ({ page }) => {
    await transport(page); await configure(page); await create(page);
    await settings(page);
    await dialog(page).locator('input').fill('/missing');
    await dialog(page).locator('button[type=submit]').click();
    await expect(dialog(page).getByRole('alert')).toContainText('managed Python');
    expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.installation'))).toBe('/fixture/install');
    await dialog(page).locator('input').fill('/fixture/other');
    await dialog(page).locator('button[type=submit]').click();
    await expect(dialog(page).getByRole('status')).toContainText('Verified');
    await page.keyboard.press('Escape');
    await expect(page.locator('.runner-row .nav-row')).toHaveAttribute('aria-current', 'page');
    const tabs = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs);
    expect(tabs[0].installationRoot).toBe('/fixture/install');
    await page.reload();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.single-entry')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.installation'))).toBe('/fixture/other');
    await expect(page.locator('.runner-row')).toHaveCount(1);
  });
}
