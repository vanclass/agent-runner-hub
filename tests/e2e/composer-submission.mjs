export function registerComposerSubmission({ test, expect, transport, configure, create }) {
  for (const outcome of ['started', 'rejected', 'unknown', 'not-sent']) test(`compact retained composer ${outcome}`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true, workMode: outcome === 'rejected' ? 'rejected' : 'started' });
    await page.addInitScript(outcome => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'runner_feature' && args.request.request?.operation === 'work.submit') {
          window.__submitHeld = true;
          await new Promise(resolve => { window.__releaseSubmit = resolve; });
          if (outcome === 'unknown') throw Error('receipt unavailable');
          if (outcome === 'not-sent') return { state: 'not-sent', detail: 'fixture unsent' };
        }
        return original(command, args);
      };
    }, outcome);
    await configure(page); await create(page);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    const input = page.locator('textarea[data-instruction]');
    const height = () => input.evaluate(n => n.getBoundingClientRect().height);
    await expect(input).toBeEnabled(); const base = await height();
    const draft = Array.from({ length: 60 }, (_, i) => `한국어 English multiline ${i}`).join('\n');
    await input.fill(draft); expect(await height()).toBeGreaterThan(base);
    await input.press('Enter');
    await page.waitForFunction(() => window.__submitHeld);
    expect(await height()).toBeCloseTo(base, 0); await expect(input).toHaveValue(draft);
    const boxes = await page.evaluate(() => ['.terminal-host', '.runner-composer-content'].map(s => {
      const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height };
    }));
    expect(boxes[0].height).toBeGreaterThan(100); expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 1);
    await info.attach('pending-compact-composer', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.locator('.runner-row .nav-row').first().click();
    expect(await height()).toBeCloseTo(base, 0);
    await page.evaluate(() => window.__releaseSubmit());
    if (outcome === 'started') await expect(input).toHaveValue('', { timeout: 35000 });
    else {
      await expect(input).toHaveValue(draft);
      if (outcome === 'unknown') await expect(input).toBeDisabled();
      else { await expect(input).toBeEnabled(); await input.press('End'); }
    }
    expect(await height()).toBeCloseTo(base, 0);
    if (outcome === 'rejected' || outcome === 'not-sent') {
      await input.fill(draft + ' edited'); expect(await height()).toBeGreaterThan(base);
    }
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
