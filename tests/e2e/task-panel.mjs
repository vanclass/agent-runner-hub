export function registerTaskPanel({ test, expect, transport, configure, create, generatedFixture }) {
  test('task panel preserves a restored unavailable mode visibly after catalog inspection', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.evaluate(() => {
      const key = 'agent-runner-hub.preferences.v1', preferences = JSON.parse(localStorage.getItem(key));
      preferences.singleEntry.runMode = 'restored-unavailable-mode';
      localStorage.setItem(key, JSON.stringify(preferences));
    });
    await page.reload();
    const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
    const retained = mode.locator('option:checked');
    await expect(retained).toContainText('restored-unavailable-mode'); await expect(retained).toHaveAttribute('disabled', '');
    await page.getByRole('combobox', { name: 'Requested Model', exact: true }).focus();
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toBeEnabled();
    await expect(retained).toContainText('restored-unavailable-mode');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry.runMode)).toBe('restored-unavailable-mode');
  });
  test('task panel conditional root retains draft across modes and reload with App Settings reuse', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    const root = page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true });
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('direct-run'));
    await root.fill('C:/retained-root');
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    await expect(root).toHaveCount(0);
    const conversion = await page.evaluate(async () => {
      const { entryDefaultsToDesired } = await import('/src/hub/runnerConfigDefaults.ts');
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { service } = createConfigHarness(); await service.inspect();
      return entryDefaultsToDesired(JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry, service.catalog);
    });
    expect(conversion.unresolved).not.toContain('root');
    expect(conversion.desired).not.toHaveProperty('root');
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toHaveValue(JSON.stringify('issue-run'));
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('pure-direct-run'));
    await expect(root).toHaveValue('C:/retained-root');

    await expect(page.locator('.task-panel').getByRole('checkbox', { name: 'Reuse an eligible idle Runner' })).toHaveCount(0);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(root).toHaveValue('C:/retained-root');
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature?.config.requests ?? []).filter(r => r.operation.endsWith('.apply')))).toEqual([]);
  });
  for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
    test(`task panel desktop geometry, scrolling, keyboard collapse and overlay ${language} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1440, height: 800 });
      await transport(page, undefined, { auto: true, work: true }); await configure(page);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
      const body = page.locator('.task-panel-body'), toggle = page.locator('.task-panel-toggle');
      const nav = await page.locator('.sidebar').boundingBox(), center = await page.locator('.workspace').boundingBox();
      const right = await page.locator('.task-panel').boundingBox();
      expect(nav.width).toBeGreaterThanOrEqual(200); expect(nav.width).toBeLessThanOrEqual(220);
      expect(right.width).toBeGreaterThanOrEqual(300); expect(right.width).toBeLessThanOrEqual(340);
      expect(center.x + center.width).toBe(right.x);
      await expect(page.locator('.workspace .context-settings')).toHaveCount(0);
      const original = await page.locator('.composer').boundingBox();
      await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
      expect(await body.evaluate(node => node.scrollTop)).toBe(await body.evaluate(node => Math.max(0, node.scrollHeight - node.clientHeight)));
      expect(await page.locator('.composer').boundingBox()).toEqual(original);
      await create(page);
      expect((await page.locator('.task-panel').boundingBox()).x).toBe(right.x);
      await expect(page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' })).toHaveCount(0);
      await page.getByRole('button', { name: 'App settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.getByRole('button', { name: language === 'en' ? (theme === 'light' ? 'Light' : 'Black') : (theme === 'light' ? '라이트' : '블랙'), exact: true }).click();
      await page.keyboard.press('Escape');
      const panel = page.locator('.task-panel'), mode = panel.locator('.execution-settings select').first();
      await panel.locator('.account-settings select').focus();
      await expect(mode).toBeEnabled();
      await expect(panel.locator('.advanced-settings, .mode-segments')).toHaveCount(0);
      await expect(panel.getByRole('checkbox', { name: /Reuse|재사용/ })).toHaveCount(0);
      expect(await panel.locator('.settings-group').evaluateAll(nodes => nodes.map(n => n.className)))
        .toEqual(['settings-group account-settings', 'settings-group execution-settings', 'settings-group model-settings']);
      expect(await mode.locator('option:not([value=""])').allTextContents())
        .toEqual(['Pure Direct Run', 'Direct Run', 'Task Run', 'Issue Run']);
      for (const value of ['pure-direct-run', 'direct-run', 'task-run', 'issue-run']) {
        await mode.selectOption(JSON.stringify(value));
        const direct = value.includes('direct-run');
        await expect(panel.locator('.directory-input')).toHaveCount(direct ? 1 : 0);
        await expect(panel.locator('.execution-settings > .setting select')).toHaveCount(direct ? 1 : 2);
        if (!direct) {
          const target = panel.locator('.execution-settings > .setting select').last();
          await expect(target.getByRole('option', { name: 'Exact', exact: true })).toBeAttached();
          await target.selectOption({ label: 'Exact' });
          expect(JSON.parse(await target.inputValue())).toEqual({ binding_state: 'bound', owner: 'Project', project: 'Exact' });
        }
      }
      await info.attach('desktop-panel', { body: await page.screenshot(), contentType: 'image/png' });
      await toggle.focus(); await page.keyboard.press('Enter');
      await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(body).toBeHidden(); await page.keyboard.press('Space'); await expect(body).toBeVisible();
      for (const size of [{ width: 1000, height: 700 }, { width: 760, height: 560 }, { width: 626, height: 450 }, { width: 480, height: 600 }]) {
        await page.setViewportSize(size);
        if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
        await expect(page.locator('.composer textarea')).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await page.locator('.output').boundingBox()).height).toBeGreaterThanOrEqual(80);
        await toggle.click(); await expect(body).toBeVisible();
        expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await expect(toggle).toBeInViewport();
        await info.attach(`panel-${size.width}`, { body: await page.screenshot(), contentType: 'image/png' });
        await toggle.click();
      }
    });
  }
  test('task panel preserves defaults, Fast capability and each Runner draft through tab switches', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    const model = page.getByRole('combobox', { name: 'Requested Model', exact: true });
    const fast = page.getByRole('checkbox', { name: 'Fast', exact: true });
    await model.selectOption({ label: 'm0' }); await fast.check();
    await model.selectOption({ label: 'm1' });
    await expect(fast).toBeChecked(); await expect(fast).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Saved value retained: fast' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Requested Account', exact: true }).selectOption(JSON.stringify({ agent_id: 'codex', profile_name: 'second' }));
    await expect(model).toBeEnabled(); await expect(fast).toBeChecked(); await expect(fast).toBeDisabled();
    expect(await model.inputValue()).toContain('m1');
    await model.selectOption({ label: 's0' }); await expect(fast).toBeEnabled();
    await create(page); await create(page);
    const draft = page.getByRole('combobox', { name: 'Requested Model', exact: true });
    await draft.focus(); await draft.selectOption({ label: 's2' }); await fast.check();
    await expect(page.getByRole('button', { name: 'Use default tier', exact: true })).toHaveCount(0);
    await fast.uncheck();
    await expect(fast).not.toBeChecked();
    await expect(draft).toHaveValue(/s2/);
    await fast.check();
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await draft.focus(); await expect(draft).toHaveValue(/s0/); await expect(fast).toBeChecked();
    await draft.selectOption({ label: 's1' }); await expect(fast).toBeDisabled();
    await page.locator('.runner-row').nth(1).locator('.nav-row').click();
    await expect(draft).toHaveValue(/s2/); await expect(fast).toBeChecked();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    expect(await model.inputValue()).toContain('s0'); await expect(fast).toBeChecked();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry.model)).toEqual({ model: 's0', reasoning_effort: 'medium', service_tier: 'fast' });
  });
  test('task panel keeps a crowded Runner composer reachable at narrow native-scale dimensions', async ({ page }) => {
    await transport(page, undefined, { auto: true, clipboard: true, ...generatedFixture() });
    await configure(page); await create(page);
    await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await expect(page.locator('.generated-images summary')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Verified generated image', exact: true })).toBeVisible();
    for (const size of [{ width: 626, height: 450 }, { width: 608, height: 416 }]) {
      await page.setViewportSize(size);
      const composer = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
      await composer.focus(); await composer.fill('local draft only');
      await expect(composer).toBeInViewport();
      await page.getByRole('button', { name: 'Send instruction', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeInViewport();
      await expect(page.locator('.workspace .composer-area')).toHaveCSS('overflow-y', 'auto');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
  for (const status of ['invalid', 'confirmation_required']) {
    test(`task panel blocks work for ${status} plans without command controls`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
      await page.evaluate(status => {
        for (const s of window.__nativeFixture.sessions.values()) s.feature.config.planStatus = status;
      }, status);
      await page.getByRole('combobox', { name: 'Requested Model', exact: true }).focus();
      await page.getByRole('combobox', { name: 'Requested Model', exact: true }).selectOption({ label: 'm2' });
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
      await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('unsent');
      await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Apply reviewed plan', exact: true })).toHaveCount(0);
      await expect(page.locator('.config-plan')).toContainText(status === 'invalid' ? 'CONFIG_MODEL_INVALID' : 'release_context_in_runner_terminal');
      await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('unsent');
      await expect(page.locator('.task-panel .shortcut-bar, .task-panel .command-button')).toHaveCount(0);
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation !== 'work.list'))).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests.filter(r => r.operation.endsWith('.apply')))).toEqual([]);
    });
  }
}
