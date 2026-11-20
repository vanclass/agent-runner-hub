export function registerInstructionHistory({ test, expect, transport, configure, create }) {
  test('instruction history starts empty when the same idle session gets a new tab', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true });
    await configure(page);
    await create(page);
    await page.evaluate(async () => {
      const { RunnerSession } = await import('/src/hub/RunnerSessions.ts');
      const hide = RunnerSession.prototype.hide;
      RunnerSession.prototype.hide = function () {
        hide.call(this);
        window.__releasedInstructionSession = this;
      };
    });

    const row = page.locator('.runner-row');
    const oldId = await row.getAttribute('data-runner-id');
    const input = page.locator('textarea[data-instruction]');
    await input.click();
    await page.keyboard.insertText('Removed draft');
    await input.press('Control+a');
    await input.press('Backspace');
    await expect(input).toHaveValue('');
    await input.press('Control+z');
    await expect(input).toHaveValue('Removed draft');
    await input.press('Control+y');
    await expect(input).toHaveValue('');
    await page.keyboard.insertText('Undone draft');
    await input.press('Control+z');
    await expect(input).toHaveValue('');

    await row.locator('.remove-action').click();
    const confirm = page.getByRole('button', { name: 'Terminate and close tab' });
    if (await confirm.isVisible()) await confirm.click();
    await expect(row).toHaveCount(0);
    await page.waitForFunction(() => window.__releasedInstructionSession?.reusableIdle);
    await create(page);
    const newId = await row.getAttribute('data-runner-id');
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldId);
    expect(await page.evaluate(id => {
      const session = window.__releasedInstructionSession;
      return session.view.id === id && !!session.terminal.element?.closest('.terminal-host');
    }, newId)).toBe(true);
    const deliveryCounts = () => page.evaluate(() => {
      const fixture = window.__nativeFixture;
      return {
        work: [...fixture.sessions.values()].flatMap(session => session.feature.requests)
          .filter(request => request.operation === 'work.submit').length,
        commands: fixture.commands.length,
        writes: fixture.writes.length,
      };
    });
    const before = await deliveryCounts();
    await expect(input).toHaveValue('');
    for (const chord of ['Control+y', 'Control+z', 'Control+y']) {
      await input.press(chord);
      await expect(input).toHaveValue('');
    }
    expect(await deliveryCounts()).toEqual(before);
  });

  test('instruction history stays with the focused draft and clears after delivery', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true });
    await configure(page);
    await create(page);
    await create(page);
    await page.getByRole('combobox', { name: 'Requested Project / Target', exact: true }).selectOption({ label: 'Exact' });

    const input = page.locator('textarea[data-instruction]');
    const single = page.getByRole('button', { name: 'Single Entry', exact: true });
    const runners = page.locator('.runner-row .nav-row');
    const drafts = [single, runners.nth(0), runners.nth(1)];
    const requests = () => page.evaluate(() => {
      const fixture = window.__nativeFixture;
      return {
        work: [...fixture.sessions.values()].flatMap(s => s.feature.requests
          .filter(r => r.operation === 'work.submit').map(r => r.instruction)),
        commands: fixture.commands.length,
        writes: fixture.writes.length,
      };
    });
    const baseline = await requests();
    const cdp = await page.context().newCDPSession(page);

    for (const [index, tab] of drafts.entries()) {
      await tab.click();
      await expect(input).toBeEditable();
      await input.click();
      const initial = `draft ${index} 한국어`;
      await page.keyboard.insertText(initial);
      await input.press('Shift+Enter');
      await expect(input).toHaveValue(initial + '\n');
      await page.keyboard.insertText('둘째 line');
      const multiline = initial + '\n둘째 line';
      await expect(input).toHaveValue(multiline);
      await input.press('Control+z');
      await expect(input).toHaveValue(initial + '\n');
      await input.press('Control+y');
      await expect(input).toHaveValue(multiline);
      await input.press('Control+z');
      await page.keyboard.insertText('branch');
      await input.press('Control+y');
      const branch = initial + '\nbranch';
      await expect(input).toHaveValue(branch);

      await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
      await input.dispatchEvent('keydown', { key: 'z', ctrlKey: true, isComposing: true });
      await cdp.send('Input.insertText', { text: '한' });
      await expect(input).toHaveValue(branch + '한');
      await input.press('Control+z');
      await expect(input).toHaveValue(branch);
      await input.press('Control+y');
      await expect(input).toHaveValue(branch + '한');
    }
    expect(await requests()).toEqual(baseline);

    await runners.nth(1).click();
    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue('draft 2 한국어\nbranch한');
    await page.keyboard.press('Control+Shift+Home');
    await expect(single).toHaveAttribute('aria-current', 'page');

    for (const [index, tab] of drafts.slice(0, 2).entries()) {
      await tab.click();
      await expect(input).toHaveValue(`draft ${index} 한국어\nbranch한`);
      await input.press('Control+z');
      await expect(input).toHaveValue(`draft ${index} 한국어\nbranch`);
      await input.press('Control+y');
      await input.press('Enter');
      await tab.click();
      await expect(input).toHaveValue('', { timeout: 35_000 });
      await expect(input).toBeEditable();
      await input.press('Control+z');
      await input.press('Control+y');
      await expect(input).toHaveValue('');
    }

    await runners.nth(1).click();
    await input.press('Control+z');
    await expect(input).toHaveValue('draft 2 한국어\nbranch');
    const after = await requests();
    expect(after.work).toHaveLength(baseline.work.length + 2);
    expect(after.work).toEqual(expect.arrayContaining([
      expect.stringContaining('draft 0 한국어\nbranch한'),
      expect.stringContaining('draft 1 한국어\nbranch한'),
    ]));
    expect(after.commands).toBe(baseline.commands);
    expect(after.writes).toBe(baseline.writes);
  });
}
