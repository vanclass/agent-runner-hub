export function registerQuickSettings({ test, expect, transport, configure, create, chooseAppPreference }) {
  async function setup(page, quickConfirm = false) {
    await transport(page, undefined, { work: true, auto: true, quick: true, quickConfirm });
    await configure(page);
    await expect(page.getByRole('region', { name: 'Runner quick settings' })).toHaveCount(0);
    await create(page);
    return page.getByRole('region', { name: 'Runner quick settings' });
  }

  test('Runner quick settings proportional row, anchored choices and themes', async ({ page }, info) => {
    const bar = await setup(page);
    const target = bar.getByRole('button', { name: /Project \/ Target · Workspace/ });
    await target.click();
    await bar.getByRole('dialog').getByRole('button', { name: 'Exact' }).click();
    await expect(bar.getByRole('button', { name: /long registered Target label/ })).toBeVisible();
    for (const width of [1440, 1101, 900, 640, 520]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await bar.locator('.quick-grid').evaluate(grid => {
        const buttons = [...grid.children];
        const bounds = buttons.map(button => button.getBoundingClientRect());
        const scroll = grid.parentElement;
        return { y: bounds.map(value => value.y), heights: bounds.map(value => value.height),
          widths: bounds.map(value => value.width), total: grid.getBoundingClientRect().width,
          gap: +getComputedStyle(grid).columnGap.replace('px', ''), scrolls: scroll.scrollWidth > scroll.clientWidth,
          clipped: buttons[6].scrollWidth > buttons[6].clientWidth, title: buttons[6].title };
      });
      expect(new Set(layout.y).size).toBe(1);
      expect(layout.heights).toEqual(Array(7).fill(31));
      expect(layout.widths[4]).toBe(30);
      expect(layout.gap).toBe(5);
      expect(layout.title).toContain('long registered Target label');
      const variable = layout.total - 60;
      [11, 14, 23, 9, 0, 17, 26].forEach((weight, i) => {
        if (weight) expect(Math.abs(layout.widths[i] - variable * weight / 100)).toBeLessThan(1);
      });
      if (width === 520) { expect(layout.scrolls).toBe(true); expect(layout.clipped).toBe(true); }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const model = bar.getByRole('button', { name: 'Model · m0', exact: true });
    for (const theme of ['light', 'black']) {
      if (theme === 'black') {
        await chooseAppPreference(page, 'view', 'theme', 'black');
        await page.locator('.application-menu-shield').click({ position: { x: 4, y: 100 } });
      }
      await model.click();
      const popup = bar.getByRole('dialog', { name: 'Model' });
      await expect(popup.locator('button[aria-current="true"]')).toHaveText('✓m0');
      const anchor = await model.boundingBox(), menu = await popup.boundingBox();
      expect(menu.y + menu.height).toBeLessThan(anchor.y);
      await info.attach('quick-settings-' + theme, { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(model).toBeFocused();
      await expect(popup).toHaveCount(0);
    }
  });

  test('Runner quick settings continue an advertised confirmation and preserve cancellation', async ({ page }) => {
    const bar = await setup(page, true);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.providerRejection = 'CONFIG_CONFIRMATION_REQUIRED'; });
    await bar.getByRole('button', { name: 'Provider · Codex' }).click();
    await bar.getByRole('dialog').getByRole('button', { name: 'Claude', exact: true }).click();
    await bar.getByRole('button', { name: 'Open /provider in Runner' }).click();
    await expect(bar.getByText('Current context will be released.')).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.features.results
      .filter(result => result.operation === 'interaction.respond'))).toEqual([]);
    await bar.getByRole('button', { name: 'Keep context' }).click();
    await expect(bar.getByText(/CANCELLED/)).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests
      .filter(request => request.operation === 'session_config.select_provider'))).toHaveLength(1);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });

  test('Runner quick settings use scoped catalogs, confirmed receipts and originating tab defaults', async ({ page }) => {
    const bar = await setup(page);
    const choose = async (button, choice) => {
      await bar.getByRole('button', { name: button }).click();
      await bar.getByRole('dialog').getByRole('button', { name: choice, exact: true }).click();
    };
    await choose('Reasoning effort · medium', 'high');
    await expect(bar.getByRole('button', { name: 'Reasoning effort · high' })).toBeVisible();
    await bar.getByRole('button', { name: 'Fast off' }).click();
    await expect(bar.getByRole('button', { name: 'Fast on' })).toHaveAttribute('aria-pressed', 'true');
    await bar.getByRole('button', { name: 'Fast on' }).click();
    await choose('Account · first', 'second');
    await bar.getByRole('dialog').getByRole('button', { name: 's0', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const { current, requests } = window.__nativeFixture.sessions.get('pty-1').feature.config;
      return { account: current.account.profile_name, last: requests.filter(r => !r.operation.endsWith('.inspect')).slice(-2) };
    })).toMatchObject({ account: 'second' });
    await expect(bar.getByRole('button', { name: 'Account · second' })).toBeVisible();
    await choose('Model · s0', 's1');
    await expect(bar.getByRole('button', { name: 'Fast unavailable for this model' })).toHaveAttribute('aria-disabled', 'true');
    await choose('Run Mode · Task Run', 'Direct Run');
    await bar.getByRole('dialog').getByRole('button', { name: /Browse/ }).click();
    await expect(bar.getByRole('button', { name: 'Direct / Pure Direct Root · /fixture/folder' })).toBeVisible();

    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.providerRejection = 'CONFIG_PROVIDER_STALE'; });
    await choose('Provider · Codex', 'Claude');
    await expect(bar.getByText(/CONFIG_PROVIDER_STALE/)).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.providerRejection = ''; });
    await choose('Provider · Codex', 'Claude');
    await expect(bar.getByRole('button', { name: 'Provider · Claude' })).toBeVisible();
    await bar.getByRole('button', { name: 'Account · first' }).click();
    await expect(bar.getByRole('dialog').getByRole('button', { name: 'second', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    await page.locator('.runner-row').first().click();
    await expect(bar.getByRole('button', { name: 'Provider · Claude' })).toBeVisible();

    const composer = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
    await composer.fill('Quick settings preserve the originating tab.');
    await composer.press('Enter');
    await expect.poll(() => page.evaluate(() => {
      const { config, requests } = window.__nativeFixture.sessions.get('pty-1').feature;
      return { submitted: requests.some(request => request.operation === 'work.submit'), ...config.current };
    })).toMatchObject({ submitted: true, run_mode: 'direct-run', root: '/fixture/folder',
      account: { agent_id: 'claude', profile_name: 'first' } });
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
