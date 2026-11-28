export function registerQuickSettings({ test, expect, transport, configure, create, chooseAppPreference }) {
  async function setup(page, quickConfirm = false) {
    await transport(page, undefined, { work: true, auto: true, quick: true, quickConfirm });
    await configure(page);
    await expect(page.getByRole('region', { name: 'Runner quick settings' })).toHaveCount(0);
    await create(page);
    const terminal = page.locator('.xterm-rows');
    await expect(terminal).toContainText(/pty-\d+:/);
    await terminal.evaluate(node => { window.__quickSession = node.textContent.match(/pty-\d+/)[0]; });
    return page.getByRole('region', { name: 'Runner quick settings' });
  }

  test('Runner quick settings discover Providers and resume Work and options after None', async ({ page }) => {
    const bar = await setup(page);
    const counts = () => page.evaluate(() => {
      const { config, requests } = window.__nativeFixture.sessions.get(window.__quickSession).feature;
      return { inspect: config.requests.filter(r => r.operation === 'session_config.inspect').length,
        providers: config.requests.filter(r => r.operation === 'session_config.providers').length,
        work: requests.filter(r => r.operation === 'work.list').length };
    });
    await expect.poll(async () => (await counts()).inspect).toBe(3);
    await page.clock.install();
    await page.evaluate(() => {
      const { config } = window.__nativeFixture.sessions.get(window.__quickSession).feature;
      config.current.account = { agent_id: 'none', profile_name: '' };
    });
    await expect(bar.getByRole('button', { name: 'Provider · None' })).toBeVisible();
    const inactive = await counts();
    await page.clock.runFor(3500);
    expect(await counts()).toEqual(inactive);
    await bar.getByRole('button', { name: 'Provider · None' }).click();
    await bar.getByRole('button', { name: 'Codex', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    await expect.poll(async () => (await counts()).inspect).toBe(inactive.inspect + 1);
    await expect.poll(async () => (await counts()).work).toBeGreaterThan(inactive.work);
    expect((await counts()).providers).toBe(1);
  });

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

  test('Runner quick settings reuse startup options across elapsed time, tab changes and menu openings', async ({ page }) => {
    await page.clock.install();
    const bar = await setup(page);
    const trigger = bar.getByRole('button', { name: 'Model · m0' });
    const popup = bar.getByRole('dialog', { name: 'Model' });
    const requests = () => page.evaluate(() => window.__nativeFixture.sessions.get(window.__quickSession).feature.config.requests);
    await expect.poll(async () => (await requests()).length).toBe(4);
    const initial = await requests();
    await trigger.click();
    await expect(popup.getByRole('button', { name: 'm1', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    await page.locator('.runner-row').first().click();
    await page.clock.fastForward(65_000);
    await trigger.click();
    await expect(popup.getByRole('button', { name: 'm1', exact: true })).toBeVisible();
    expect(await requests()).toEqual(initial);
  });

  test('Runner quick settings count startup, menu and reasoning requests', async ({ page }, info) => {
    const bar = await setup(page);
    const requests = () => page.evaluate(() => window.__nativeFixture.sessions.get(window.__quickSession).feature.config.requests
      .map(request => request.operation.replace('session_config.', '')));
    const trigger = bar.getByRole('button', { name: 'Reasoning effort · medium' });
    await expect(page.getByRole('combobox', { name: 'Requested Model' }).getByRole('option', { name: 'm1', exact: true })).toBeAttached();
    await expect(bar).toHaveAttribute('aria-busy', 'false');
    await expect.poll(requests).toHaveLength(4);
    const startup = await requests();
    for (let i = 0; i < 2; i++) {
      await trigger.click();
      await expect(bar.getByRole('dialog').getByRole('button', { name: 'high' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    const menus = (await requests()).slice(startup.length);
    await trigger.click();
    const choice = bar.getByRole('dialog').getByRole('button', { name: 'high' });
    await expect(choice).toBeVisible();
    const before = (await requests()).length;
    await choice.click();
    await expect(bar.getByRole('button', { name: 'Reasoning effort · high' })).toBeVisible();
    await expect(bar).toHaveAttribute('aria-busy', 'false');
    const change = (await requests()).slice(before);
    const counts = { startup, menus, change };
    await info.attach('configuration-requests', { body: JSON.stringify(counts), contentType: 'application/json' });
    expect(startup.filter(op => op === 'inspect')).toHaveLength(3);
    expect(startup.filter(op => op === 'providers')).toHaveLength(1);
    expect(menus).toEqual([]);
    expect(change).toEqual(['plan', 'apply', 'inspect']);
  });

  test('Runner quick settings use the applicable model when changing reasoning', async ({ page }) => {
    await page.clock.install();
    const bar = await setup(page);
    const popup = bar.getByRole('dialog');
    await expect(page.getByRole('combobox', { name: 'Requested Model' }).getByRole('option', { name: 'm1', exact: true })).toBeAttached();
    await bar.getByRole('button', { name: 'Model · m0' }).click();
    await popup.getByRole('button', { name: 'm1', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Model · m1' })).toBeVisible();
    await bar.getByRole('button', { name: 'Reasoning effort · medium' }).click();
    await popup.getByRole('button', { name: 'high', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Reasoning effort · high' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Model · m1' })).toBeVisible();
    await bar.getByRole('button', { name: 'Reasoning effort · high' }).click();
    const medium = popup.getByRole('button', { name: 'medium', exact: true });
    await expect(medium).toBeVisible();
    await page.evaluate(() => {
      window.__nativeFixture.sessions.get(window.__quickSession).feature.config.holdOperation = 'session_config.apply';
    });
    const applies = () => page.evaluate(() => window.__nativeFixture.sessions.get(window.__quickSession).feature.config.requests
      .filter(r => r.operation === 'session_config.apply').length);
    const confirmed = await applies();
    await medium.click();
    await expect.poll(applies).toBe(confirmed + 1);
    await page.evaluate(() => {
      const config = window.__nativeFixture.sessions.get(window.__quickSession).feature.config;
      config.current.model = { id: 'm2', reasoning_effort: 'medium' };
      config.revision = 'f'.repeat(64);
      config.holdOperation = '';
      config.complete();
    });
    await expect(bar.getByText(/CONFIG_REVISION_STALE/)).toBeVisible();
    expect(await page.evaluate(() => {
      const config = window.__nativeFixture.sessions.get(window.__quickSession).feature.config;
      return config.current.model;
    })).toEqual({ id: 'm2', reasoning_effort: 'medium' });
    expect(await applies()).toBe(confirmed + 1);
  });

  test('Runner quick settings continue an advertised confirmation and preserve cancellation', async ({ page }) => {
    const bar = await setup(page, true);
    await page.evaluate(() => {
      for (const session of window.__nativeFixture.sessions.values())
        session.feature.config.providerRejection = 'CONFIG_CONFIRMATION_REQUIRED';
    });
    await bar.getByRole('button', { name: 'Provider · Codex' }).click();
    await bar.getByRole('dialog').getByRole('button', { name: 'Claude', exact: true }).click();
    await bar.getByRole('button', { name: 'Open /provider in Runner' }).click();
    await expect(bar.getByText('Current context will be released.')).toBeVisible();
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()]
      .flatMap(session => session.feature.features.results.filter(result => result.operation === 'interaction.respond')))).toEqual([]);
    await bar.getByRole('button', { name: 'Keep context' }).click();
    await expect(bar.getByText(/CANCELLED/)).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()]
      .flatMap(session => session.feature.config.requests.filter(request => request.operation === 'session_config.select_provider')))).toHaveLength(1);
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
    const accountReads = () => page.evaluate(() => window.__nativeFixture.sessions.get(window.__quickSession).feature.config.requests
      .filter(r => r.operation === 'session_config.inspect' && r.account?.profile_name === 'second').map(r => r.offset));
    expect(await accountReads()).toEqual([]);
    await choose('Account · first', 'second');
    await bar.getByRole('dialog').getByRole('button', { name: 's0', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const { current, requests } = window.__nativeFixture.sessions.get(window.__quickSession).feature.config;
      return { account: current.account.profile_name, last: requests.filter(r => !r.operation.endsWith('.inspect')).slice(-2) };
    })).toMatchObject({ account: 'second' });
    await expect(bar.getByRole('button', { name: 'Account · second' })).toBeVisible();
    await choose('Model · s0', 's1');
    await expect(bar.getByRole('button', { name: 'Fast unavailable for this model' })).toHaveAttribute('aria-disabled', 'true');
    expect(await accountReads()).toEqual([0, 2, 4]);
    await choose('Run Mode · Task Run', 'Direct Run');
    await bar.getByRole('dialog').getByRole('button', { name: /Browse/ }).click();
    await expect(bar.getByRole('button', { name: 'Direct / Pure Direct Root · /fixture/folder' })).toBeVisible();

    await page.evaluate(() => { window.__nativeFixture.sessions.get(window.__quickSession).feature.config.providerRejection = 'CONFIG_PROVIDER_STALE'; });
    await choose('Provider · Codex', 'Claude');
    await expect(bar.getByText(/CONFIG_PROVIDER_STALE/)).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Provider · Codex' })).toBeVisible();
    await page.evaluate(() => { window.__nativeFixture.sessions.get(window.__quickSession).feature.config.providerRejection = ''; });
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
      const { config, requests } = window.__nativeFixture.sessions.get(window.__quickSession).feature;
      return { submitted: requests.some(request => request.operation === 'work.submit'), ...config.current };
    })).toMatchObject({ submitted: true, run_mode: 'direct-run', root: '/fixture/folder',
      account: { agent_id: 'claude', profile_name: 'first' } });
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
