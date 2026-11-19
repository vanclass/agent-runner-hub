export function registerComposerSubmission({ test, expect, transport, configure, create }) {
  for (const single of [false, true]) for (const variant of ['complete', 'owner', 'project', 'missing', 'fields', 'unavailable', 'mismatch'])
    test(`TaskRun prepared instruction ${single ? 'Single Entry' : 'Runner'} ${variant}`, async ({ page }) => {
      await transport(page, undefined, { work: true, auto: true, workMode: variant === 'mismatch' ? 'rejected' : 'started' }); await configure(page); await create(page);
      if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
      await page.getByRole('combobox', { name: 'Requested Project / Target', exact: true }).selectOption({ label: 'Exact' });
      if (variant === 'unavailable') await page.evaluate(() => {
        for (const session of window.__nativeFixture.sessions.values()) {
          const inspect = session.feature.config.inspection.bind(session.feature.config);
          session.feature.config.inspection = (...args) => {
            const result = inspect(...args); result.options.targets = []; result.options_page.totals.targets = 0; return result;
          };
        }
      });
      const body = variant === 'fields' ? 'Task: Fix the login error\nPriority: High\nOwner: body\nProject: body\nReasoning: HIGH\n안녕 🌍\n'
        : 'Goal\n안녕 🌍\nTarget\nProject: body';
      const draft = ['complete', 'mismatch'].includes(variant) ? 'Target\nOwner: Project\nProject: Explicit\nReasoning: high\n' + body
        : variant === 'owner' ? 'Target\nOwner: Project\n' + body
        : variant === 'project' ? 'Target\nProject: Explicit\n' + body : body;
      const expected = ['complete', 'mismatch'].includes(variant) ? draft : variant === 'owner' ? draft.replace('Target\n', 'Target\nProject: Exact\n')
        : variant === 'project' ? draft.replace('Target\n', 'Target\nOwner: Project\n') : 'Target\nOwner: Project\nProject: Exact\n\n' + (variant === 'fields' ? 'Goal\n' : '') + body;
      const input = page.locator('textarea[data-instruction]'); await input.fill(draft); await input.press('Enter');
      if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      if (['unavailable', 'mismatch'].includes(variant)) { await expect(input).toBeEnabled(); await expect(input).toHaveValue(draft); }
      else await expect(input).toHaveValue('', { timeout: 35000 });
      const evidence = await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests
        .filter(r => r.operation === 'work.submit').map(r => r.instruction)));
      expect(evidence).toEqual(variant === 'unavailable' ? [] : [expected]);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.config.requests)
        .filter(r => r.operation === 'session_config.plan').every(r => !('target' in r.desired) && !('model' in r.desired)))).toBe(true);
    });
  for (const single of [false, true]) for (const outcome of ['started', 'rejected', 'unknown', 'not-sent']) test(`compact retained composer ${single ? 'Single Entry' : 'Runner'} ${outcome}`, async ({ page }, info) => {
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
        const result = await original(command, args);
        if (command === 'runner_observe') result.presentationSupported = true;
        return result;
      };
    }, outcome);
    await configure(page); await create(page);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    const input = page.locator('textarea[data-instruction]');
    const height = () => input.evaluate(n => n.getBoundingClientRect().height);
    await expect(input).toBeEnabled(); const base = await height();
    const draft = Array.from({ length: 60 }, (_, i) => `한국어 English multiline ${i}`).join('\n');
    await input.fill(draft); expect(await height()).toBeGreaterThan(base);
    await input.press('Enter');
    await page.waitForFunction(() => window.__submitHeld);
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    expect(await height()).toBeCloseTo(base, 0); await expect(input).toHaveValue(draft);
    const boxes = await page.evaluate(() => ['.output', '.composer-area'].map(s => {
      const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height };
    }));
    expect(boxes[0].height).toBeGreaterThan(100); expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 1);
    await info.attach('pending-compact-composer', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.locator('.runner-row .nav-row').first().click();
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    expect(await height()).toBeCloseTo(base, 0);
    await page.evaluate(() => window.__releaseSubmit());
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
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
