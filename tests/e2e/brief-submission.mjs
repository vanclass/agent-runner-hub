export function registerBriefSubmission({ test, expect, transport, configure, create }) {
  const input = page => page.locator('.composer-area textarea[data-instruction]');
  async function ready(page, tab, options = {}) {
    await transport(page, undefined, { auto: true, work: true, brief: 'accepted', ...options });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    if (tab) await create(page);
    const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
    await mode.focus();
    await expect(mode.getByRole('option', { name: 'issue-run', exact: true })).toBeAttached();
    await mode.selectOption({ label: 'issue-run' });
  }
  for (const tab of [false, true]) {
    const path = tab ? 'Runner tab' : 'Single Entry';
    test(`Brief Run ${path} preserves exact multiline body and waits for owner completion`, async ({ page }, info) => {
      await ready(page, tab, { runResult: 'queued' });
      const body = '  한글 🌍\n    indented\t \n/run remains Brief text  \n\n';
      await input(page).fill(body); await input(page).focus();
      await page.keyboard.down('Control'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
      await page.keyboard.up('Enter'); await page.keyboard.up('Control');
      if (!tab) await page.keyboard.press('Control+Home');
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.commands.length), { timeout: 35000 }).toBe(1);
      await expect(input(page)).toBeDisabled();
      const original = await page.evaluate(() => {
        const n = window.__nativeFixture, s = n.sessions.get('pty-1');
        return { body: s.briefRequests, commands: n.commands, work: s.feature.requests, writes: n.writes, mode: s.feature.config.current.run_mode };
      });
      expect(original.body).toEqual([{ operation: 'brief.stage', api_version: 1, body }]);
      expect(original.commands).toEqual([{ id: 'pty-1', command: '/run' }]);
      expect(original.mode).toBe('issue-run'); expect(original.work).toEqual([]); expect(original.writes).toEqual([]);
      await page.evaluate(() => Object.assign(window.__nativeFixture.sessions.get('pty-1').control.results[0],
        { state: 'accepted', phase: 'completed', ownerStatus: 'SUCCESS' }));
      await expect(page.getByRole('status').filter({ hasText: 'Run requested and confirmed by Runner' }).first()).toBeVisible();
      if (!tab) await page.keyboard.press('Control+Home');
      await expect(input(page)).toHaveValue('');
      await info.attach('brief-run-confirmed', { body: await page.screenshot(), contentType: 'image/png' });
    });
    for (const brief of ['rejected', 'unknown', 'unsupported', 'malformed', 'crossed', 'disconnected']) {
      test(`Brief Run ${path} never runs after ${brief} staging`, async ({ page }) => {
        await ready(page, tab, { brief });
        await input(page).fill('  retained 한글\ntrailing  \n'); await input(page).press('Control+Enter');
        if (!tab) await page.keyboard.press('Control+Home');
        const label = brief === 'rejected' ? 'Brief rejected' : brief === 'unsupported' ? 'Brief → Run unavailable' : 'Brief staging uncertain';
        await expect(page.getByRole('status').filter({ hasText: label }).first()).toBeVisible({ timeout: 35000 });
        if (!tab) await page.keyboard.press('Control+Home');
        await expect(input(page)).toHaveValue('  retained 한글\ntrailing  \n');
        await page.keyboard.press('Control+Enter');
        expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests?.length ?? 0)).toBe(brief === 'unsupported' ? 0 : 1);
        expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      });
    }
    test(`Brief Run ${path} keeps staged Brief when Run is rejected`, async ({ page }) => {
      await ready(page, tab, { runResult: 'rejected' });
      await input(page).fill('staged draft'); await input(page).press('Control+Enter');
      if (!tab) await page.keyboard.press('Control+Home');
      await expect(page.getByRole('status').filter({ hasText: 'Brief staged · Run rejected' }).first()).toBeVisible({ timeout: 35000 });
      if (!tab) await page.keyboard.press('Control+Home');
      await expect(input(page)).toHaveValue('staged draft');
      await page.keyboard.press('Control+Enter');
      expect(await page.evaluate(() => window.__nativeFixture.commands.length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests.length)).toBe(1);
    });
    test(`composer Enter ${path} shares Send and preserves editing composition and mode guards`, async ({ page }) => {
      await ready(page, tab);
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'task-run' });
      await input(page).fill('first'); await input(page).press('Shift+Enter');
      await page.keyboard.type('second'); await expect(input(page)).toHaveValue('first\nsecond');
      await input(page).press('Home'); await expect(input(page)).toBeFocused();
      await input(page).press('Control+Enter'); await expect(input(page)).toHaveValue('first\nsecond');
      await input(page).evaluate(node => {
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
      });
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
      await input(page).press('Enter');
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit')))
        .toMatchObject([{ instruction: 'first\nsecond' }]);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    });
    test(`Brief Run ${path} never replays an uncertain Run`, async ({ page }) => {
      await ready(page, tab, { runResult: 'outcome-unknown' });
      await input(page).fill('retained after Run'); await input(page).press('Control+Enter');
      if (!tab) await page.keyboard.press('Control+Home');
      await expect(page.getByRole('status').filter({ hasText: 'Run outcome uncertain' }).first()).toBeVisible({ timeout: 35000 });
      await expect(input(page)).toHaveValue('retained after Run');
      await page.keyboard.press('Control+Enter');
      expect(await page.evaluate(() => window.__nativeFixture.commands.length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests.length)).toBe(1);
    });
  }
  test('Brief Run never falls through to PTY when foreground ownership changes during verification', async ({ page }) => {
    await ready(page, true);
    await input(page).fill('Brief must stay out of PTY'); await input(page).press('Control+Enter');
    await page.evaluate(() => {
      window.__nativeFixture.sessions.get('pty-1').control.observation.attention.foreground_interaction_active = true;
    });
    await expect(page.getByRole('alert').filter({ hasText: 'Brief → Run unavailable' })).toBeVisible();
    await expect(input(page)).toHaveValue('Brief must stay out of PTY');
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests ?? [])).toEqual([]);
  });
  test('navigation endpoints and adjacent keys do not wrap or affect processes and drafts', async ({ page }) => {
    await ready(page, false);
    await page.keyboard.press('Control+End'); await expect(input(page)).toBeVisible();
    await page.keyboard.press('Control+PageDown'); await expect(input(page)).toBeVisible();
    await input(page).fill('entry retained'); await create(page); await create(page); await create(page);
    const rows = page.locator('.runner-row .nav-row');
    await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+PageUp');
    await expect(input(page)).toHaveValue('entry retained');
    await page.keyboard.press('Control+PageDown'); await expect(rows.nth(0)).toHaveAttribute('aria-current', 'page');
    await input(page).fill('tab retained'); await page.keyboard.press('Control+PageDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Control+End'); await page.keyboard.press('Control+PageDown');
    await expect(rows.nth(2)).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Control+PageUp'); await page.keyboard.press('Control+PageUp');
    await expect(input(page)).toHaveValue('tab retained');
    await page.keyboard.press('Control+PageUp'); await expect(input(page)).toHaveValue('entry retained');
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
  });
}
