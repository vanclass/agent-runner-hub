export function registerLogViewport({ test, expect, transport, configure, create }) {
  for (const single of [false, true]) test(`shared composer viewport ${single ? 'Single Entry' : 'Runner'}`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    const input = page.locator('textarea[data-instruction]');
    for (const [width, height] of [[1440, 1000], [1100, 550], [700, 650]]) {
      await page.setViewportSize({ width, height }); await input.fill('');
      await expect.poll(() => input.evaluate(n => {
        const s = getComputedStyle(n);
        return Math.abs(n.clientHeight - (parseFloat(s.lineHeight) * 3 + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom)));
      })).toBeLessThanOrEqual(1);
      const base = await input.evaluate(n => {
        const s = getComputedStyle(n);
        return Math.round(parseFloat(s.lineHeight) * 3 + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom));
      });
      await input.fill('wrapped words '.repeat(3000));
      await expect.poll(() => input.evaluate(n => n.clientHeight)).toBeGreaterThan(base);
      expect(await input.evaluate(n => n.scrollHeight)).toBeGreaterThan(await input.evaluate(n => n.clientHeight));
      const boxes = await page.evaluate(() => ['.output', '.composer-area', '.hub-activity'].map(s => {
        const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height };
      }));
      expect(boxes[0].height).toBeGreaterThan(45);
      expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 1);
      expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].top + 1);
      expect(boxes[2].bottom).toBeLessThanOrEqual(height);
      await info.attach(`shared-${single}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await input.fill(''); await expect.poll(() => input.evaluate(n => n.clientHeight)).toBe(base);
    }
  });
  for (const height of [550, 800]) test(`Runner composer preserves visible log at ${height}`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    await page.setViewportSize({ width: 1100, height });
    const input = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
    await expect(input).toBeEnabled();
    const geometry = () => page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
      const input = document.querySelector('.composer-area textarea'), style = getComputedStyle(input);
      return { input: rect('.composer-area textarea'), content: rect('.composer-area'),
        terminal: rect('.terminal-host'), slot: rect('.composer-area'), workspace: rect('.workspace'),
        logLine: document.querySelector('.xterm-rows > div').getBoundingClientRect().height,
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
      expect(grown.terminal.bottom).toBeLessThanOrEqual(grown.content.top + 1);
      expect(grown.terminal.height).toBeGreaterThanOrEqual(grown.logLine * 3 - 1);
      expect(grown.slot.height).toBeGreaterThan(base.slot.height);
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
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ started_event_id: expect.any(Number), work_id: expect.any(Object) })]));
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
  test('completed log viewport retains scrollback after exit and tab switching', async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true, workMode: 'succeeded' }); await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('direct-run'));
    await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('representative DirectRun');
    await page.locator('textarea[data-instruction]').press('Enter');
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ started_event_id: expect.any(Number), work_id: expect.any(Object) })]));
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'succeeded' })]));
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\r\nLOG-BEGIN\r\n' +
      Array.from({ length: 600 }, (_, i) => `line ${i} DirectRun output\r\n`).join('') + '\x1b[32mLOG-END\x1b[0m\r\n'));
    await expect(page.locator('.xterm-rows')).toContainText('LOG-END');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(page.locator('.workspace > .output, .workspace > .workspace-context, .workspace > .runner-composer')).toHaveCount(3);
    await expect(page.locator('.workspace > .hub-activity')).toHaveCount(1);
    await expect(page.locator('.runner-interaction, .runner-work-status, .runner-instructions, .terminal-tools')).toHaveCount(0);
    await expect(page.locator('.terminal-host .xterm-screen')).toBeVisible();
    await expect(page.getByText('Process exited (1)', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1100, height: 550 });
    for (const height of [550, 800]) {
      await page.setViewportSize({ width: 1100, height });
      const box = await page.locator('.terminal-host').boundingBox();
      console.log('log viewport', height, box.height);
      expect(box.height).toBeGreaterThan(height === 550 ? 140 : 300);
      expect(await page.locator('.workspace').evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThan(2);
      await expect(page.locator('.terminal-tools')).toHaveCount(0);
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
    await expect(page.locator('.xterm-rows')).toContainText('LOG-END');
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  });
}
