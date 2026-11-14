export function registerLogViewport({ test, expect, transport, configure, create }) {
  for (const height of [550, 800]) test(`Runner composer overlays log at ${height}`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    await page.setViewportSize({ width: 1100, height });
    const input = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
    await expect(input).toBeEnabled();
    const geometry = () => page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
      const input = document.querySelector('.runner-composer textarea'), style = getComputedStyle(input);
      return { input: rect('.runner-composer textarea'), content: rect('.runner-composer-content'),
        terminal: rect('.terminal-host'), slot: rect('.runner-composer'), workspace: rect('.workspace'),
        line: parseFloat(style.lineHeight), padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) };
    });
    await input.fill('one\ntwo\nthree');
    const base = await geometry();
    expect(Math.abs(base.input.height - (base.line * 3 + base.padding))).toBeLessThanOrEqual(1);
    for (const draft of ['one\ntwo\nthree\nfour', 'one\ntwo\nthree\nfour\nfive', 'wrapped words '.repeat(180)]) {
      await input.fill(draft);
      const grown = await geometry();
      expect(grown.input.height).toBeGreaterThan(base.input.height);
      expect(grown.content.bottom).toBe(base.content.bottom);
      expect(grown.content.top).toBeLessThan(base.content.top);
      expect(grown.content.top).toBeGreaterThanOrEqual(grown.workspace.top + 15);
      expect(grown.terminal).toEqual(base.terminal); expect(grown.slot).toEqual(base.slot);
    }
    await input.fill(Array.from({ length: 80 }, (_, i) => `editable line ${i}`).join('\n'));
    expect(await input.evaluate(n => n.scrollHeight > n.clientHeight)).toBe(true);
    await input.evaluate(n => { n.scrollTop = 0; }); await input.hover(); await page.mouse.wheel(0, 4000);
    await expect.poll(() => input.evaluate(n => n.scrollTop)).toBeGreaterThan(0);
    expect(await input.evaluate(n => n.scrollTop)).toBeGreaterThan(0);
    await info.attach(`composer-capped-${height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.locator('.runner-row .nav-row').first().click();
    await expect(input).toHaveValue(/editable line 79$/);
    expect((await geometry()).input.height).toBeGreaterThan(base.input.height);
    await input.fill('one\ntwo\nthree\nfour\nfive'); await input.press('Enter');
    await expect(input).toHaveValue('', { timeout: 35000 });
    expect(Math.abs((await geometry()).input.height - base.input.height)).toBeLessThanOrEqual(1);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
  });
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
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('direct-run'));
    await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('representative DirectRun');
    await page.locator('textarea[data-instruction]').press('Enter');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Succeeded');
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\r\nLOG-BEGIN\r\n' +
      Array.from({ length: 600 }, (_, i) => `line ${i} DirectRun output\r\n`).join('') + '\x1b[32mLOG-END\x1b[0m\r\n'));
    await expect(page.locator('.xterm-rows')).toContainText('LOG-END');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(page.locator('.terminal-host .xterm-screen')).toBeVisible();
    await expect(page.getByText('Process exited (1)', { exact: true })).toHaveCount(0);
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
