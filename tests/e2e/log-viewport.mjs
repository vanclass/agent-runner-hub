export function registerLogViewport({ test, expect, transport, configure }) {
  for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
    test(`quiet Single Entry ${language}/${theme}`, async ({ page }, info) => {
      await transport(page);
      await page.addInitScript(({ language, theme }) => localStorage.setItem('agent-runner-hub.preferences.v1',
        JSON.stringify({ version: 1, language, theme, singleEntry: {} })), { language, theme });
      await page.goto('/');
      await page.locator('.runner-location input').fill('/fixture/install');
      await page.locator('.runner-location button').last().click();
      await expect(page.locator('.app-settings')).toHaveCount(0);
      await expect(page.locator('.workspace-header, .workspace-symbol, .spare-status, .sidebar-empty')).toHaveCount(0);
      await expect(page.locator('.sidebar .add-runner')).toBeVisible();
      await expect(page.locator('.composer textarea')).toBeEnabled();
      await info.attach(`single-${language}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
  test('completed log viewport retains searchable scrollback after exit and tab switching', async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true, workMode: 'succeeded' }); await configure(page);
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('representative DirectRun');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Succeeded');
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\r\nLOG-BEGIN\r\n' +
      Array.from({ length: 600 }, (_, i) => `line ${i} DirectRun output\r\n`).join('') + '\x1b[32mLOG-END\x1b[0m\r\n'));
    await expect(page.locator('.xterm-rows')).toContainText('LOG-END');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(page.getByText('Process exited (1)', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 550 });
    for (const height of [550, 800]) {
      await page.setViewportSize({ width: 1100, height });
      const box = await page.locator('.terminal-host').boundingBox();
      console.log('log viewport', height, box.height);
      expect(box.height).toBeGreaterThan(height === 550 ? 140 : 300);
      expect(await page.locator('.workspace').evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThan(2);
      const search = page.getByRole('textbox', { name: 'Search terminal', exact: true });
      for (const marker of ['LOG-BEGIN', 'line 300', 'LOG-END']) {
        await search.fill(marker);
        await page.getByRole('button', { name: 'Previous', exact: true }).click();
        await expect(page.locator('.xterm-rows')).toContainText(marker);
      }
      await page.locator('.terminal-host').hover();
      for (let i = 0; i < 220; i++) await page.mouse.wheel(0, -1000);
      await expect(page.locator('.xterm-rows')).toContainText('LOG-BEGIN');
      for (let i = 0; i < 220; i++) await page.mouse.wheel(0, 1000);
      await expect(page.locator('.xterm-rows')).toContainText('LOG-END');
      await info.attach(`exited-log-${height}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.locator('.workspace-header, .workspace-symbol, .spare-status, .sidebar-empty')).toHaveCount(0);
    await page.locator('.runner-row .nav-row').first().click();
    await expect(page.getByRole('textbox', { name: 'Search terminal', exact: true })).toHaveValue('LOG-END');
    await expect(page.locator('.xterm-rows')).toContainText('LOG-END');
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  });
}
