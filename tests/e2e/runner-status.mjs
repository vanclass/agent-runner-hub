export function registerRunnerStatus({ test, expect, transport, configure, create }) {
  for (const theme of ['light', 'black']) test(`runner circular status fixed coordinates ${theme}`, async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page); await create(page);
    await page.locator('.app-settings-trigger').click();
    await page.getByRole('button', { name: theme === 'light' ? 'Light' : 'Black', exact: true }).click();
    await page.keyboard.press('Escape');
    const rows = page.locator('.runner-row');
    const coordinates = () => rows.evaluateAll(rows => rows.map(row => {
      const content = row.querySelector('.rename-row') ?? row.querySelector('.nav-row');
      const marker = content.querySelector('.status-dot').getBoundingClientRect();
      const name = content.querySelector('.runner-name, input').getBoundingClientRect();
      const input = content.querySelector('input');
      const textOffset = input ? input.clientLeft + parseFloat(getComputedStyle(input).paddingLeft) : 0;
      return { center: marker.x + marker.width / 2, name: name.x + textOffset, width: marker.width, height: marker.height };
    }));
    const baseline = await coordinates();
    expect(baseline[0]).toEqual(baseline[1]);
    for (let cycle = 0; cycle < 2; cycle++) for (const state of ['starting', 'idle', 'running', 'attention', 'unknown']) {
      await page.evaluate(state => {
        const c = window.__nativeFixture.sessions.get('pty-1').control;
        c.state = state === 'starting' ? 'connecting' : 'ready';
        c.age = state === 'unknown' ? 999999 : 0;
        c.observation.execution.owned_execution_alive = state === 'running';
        c.observation.attention.foreground_interaction_active = state === 'attention';
      }, state);
      const marker = rows.first().locator('.status-dot');
      await expect(marker).toHaveClass(`status-dot ${state}`);
      expect(await coordinates()).toEqual(baseline);
      await expect(marker).toHaveAttribute('aria-label', /.+/);
      await expect(marker).toHaveAttribute('title', await marker.getAttribute('aria-label'));
      const svg = marker.locator('svg');
      await expect(svg).toHaveAttribute('stroke-width', '2');
      await expect(svg.locator('circle')).toHaveCount(state === 'starting' ? 0 : 1);
      const colors = { idle: 'rgb(34, 197, 94)', running: 'rgb(59, 130, 246)', attention: 'rgb(255, 214, 0)', unknown: 'rgb(156, 163, 175)', starting: 'rgb(59, 130, 246)' };
      await expect(marker).toHaveCSS('color', colors[state]);
      if (state === 'starting') {
        await expect(svg).toHaveCSS('animation-name', 'runner-starting');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(svg).toHaveCSS('animation-name', 'none');
        await expect(svg.locator('path')).toHaveAttribute('d', 'M12 3a9 9 0 1 1-9 9');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      if (cycle === 0) await info.attach(`${theme}-${state}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(rows.first().locator('.status-dot.failed')).toHaveCSS('color', 'rgb(239, 68, 68)');
    expect(await coordinates()).toEqual(baseline);
    await rows.nth(1).hover(); await rows.nth(1).locator('.nav-row').focus();
    expect(await coordinates()).toEqual(baseline);
    await rows.nth(1).locator('.nav-row').press('F2');
    expect(await coordinates()).toEqual(baseline);
    await page.locator('.rename-row input').fill('Runner 2 with an exceptionally long name for truncation');
    await page.locator('.rename-row input').press('Enter');
    expect(await coordinates()).toEqual(baseline);
    await expect(rows.nth(1).locator('.runner-name')).toHaveCSS('text-overflow', 'ellipsis');
    for (let n = 0; n < 6; n++) await create(page);
    const scrollBaseline = await coordinates();
    await page.setViewportSize({ width: 950, height: 400 });
    expect(await coordinates()).toEqual(scrollBaseline);
    const list = page.locator('.runner-list');
    expect(await list.evaluate(list => list.scrollHeight > list.clientHeight)).toBe(true);
    await list.evaluate(list => { list.scrollTop = list.scrollHeight; });
    expect(await list.evaluate(list => list.scrollTop)).toBeGreaterThan(0);
    expect(await coordinates()).toEqual(scrollBaseline);
    await info.attach(`${theme}-error-long-name`, { body: await page.screenshot(), contentType: 'image/png' });
  });
  for (const code of [0, null]) test(`runner circular status normal or unobserved exit ${code} stays unknown`, async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    await page.evaluate(code => window.__nativeFixture.exit('pty-1', code), code);
    await expect(page.locator('.runner-row .status-dot.unknown')).toBeVisible();
  });
}
