export function registerPtyViewport({ test, expect, transport, configure, create }) {
  for (const capability of [true, false, undefined]) test(`PTY visible with semantic capability ${capability}`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true });
    await page.addInitScript(capability => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      window.__presentationRequests = [];
      native.invoke = async (command, args) => {
        if (command === 'runner_presentation') { window.__presentationRequests.push(args); throw Error('obsolete subscription'); }
        const result = await original(command, args);
        if (command === 'runner_observe') result.presentationSupported = capability;
        if (command === 'pty_open') window.__nativeFixture.emit(result,
          '\r\nRunner prompt >\r\n\x1b[31mRunner error\x1b[0m\r\n\x1b[?9001$p\x1b[5n');
        return result;
      };
    }, capability);
    await configure(page); await create(page);
    await expect(page.locator('.terminal-host')).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('Runner prompt >');
    await expect(page.locator('.xterm-rows')).toContainText('Runner error');
    await expect(page.locator('.runner-semantic, .presentation-limitation')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
    const before = await page.evaluate(() => window.__nativeFixture.writes);
    if (capability === true) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const row = page.locator('.xterm-rows > div').filter({ hasText: 'Runner prompt >' });
      const box = await row.boundingBox();
      await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + 145, box.y + box.height / 2); await page.mouse.up();
      await page.keyboard.press('Control+c');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Runner prompt >');
      expect(await page.locator('.xterm-rows span').filter({ hasText: 'Runner error' }).evaluate(n => getComputedStyle(n).color))
        .not.toBe(await row.evaluate(n => getComputedStyle(n).color));
    }
    await page.locator('.xterm-helper-textarea').press('x');
    await page.locator('.xterm-helper-textarea').press('Enter');
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual(before);
    expect(await page.evaluate(() => window.__presentationRequests)).toEqual([]);
    await info.attach('pty-visible', { body: await page.screenshot(), contentType: 'image/png' });
  });
  for (const single of [false, true]) for (const long of [false, true]) test(`PTY submitted text Runner-owned Single Entry ${single} long ${long}`, async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      native.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command === 'runner_observe') result.presentationSupported = true;
        if (command === 'runner_feature' && args.request.request?.operation === 'work.submit')
          window.__nativeFixture.emit(args.id, '\r\n' + args.request.request.instruction.replaceAll('\n', '\r\n') + '\r\n');
        return result;
      };
    });
    await configure(page); if (!single) await create(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    const input = page.locator('textarea[data-instruction]');
    await expect(input).toBeEnabled();
    const draft = '원본 submitted instruction\n' + (long ? '한국어 English multiline\n'.repeat(12) : '') + 'English multiline 끝';
    await input.fill(draft); await input.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('원본 submitted instruction');
    await expect(page.locator('.xterm-rows')).toContainText('English multiline 끝');
    await expect(input).toHaveValue('', { timeout: 35000 });
    expect((await page.locator('.xterm-rows').innerText()).match(/원본 submitted instruction/g)).toHaveLength(1);
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests)
      .filter(r => r.operation === 'work.submit').length)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
