export function registerSemanticViewport({ test, expect, transport, configure, create, generatedFixture }) {
  test('semantic viewport keeps PTY replies, long logs, live Activity, themes, tabs, images and composer', async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true, ...generatedFixture() });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      const streams = new Map(), requests = [], failed = new Set();
      const activity = (text, sequence, action = 'replace') => ({ type: 'activity', sequence, activity_id: 'work', action,
        text, spans: [{ text, style: 'class:activity-heading' }] });
      const log = (text, sequence, style = '') => ({ type: 'log', sequence, record_id: sequence, text,
        spans: [{ text, style }], start_offset: 0, end_offset: Array.from(text).length,
        final_fragment: true, terminate_line: true, line_ending: 'ensure' });
      window.__semantic = { streams, requests, fail(id) { failed.add(id); }, update(id, text, retire = false) {
        const stream = streams.get(id); stream.push(activity(text, stream.length + 1, retire ? 'retire' : 'replace'));
      }, append(id, text) { const stream = streams.get(id); stream.push(log(text, stream.length + 1)); } };
      native.invoke = async (command, args) => {
        if (command === 'runner_presentation') {
          if (failed.has(args.id) && args.request.operation === 'presentation.read') throw Error('fixture lost coverage');
          requests.push({ id: args.id, ...args.request });
          const events = streams.get(args.id), sub = 'u-' + args.id, stream = 's-' + args.id;
          if (args.request.operation === 'presentation.subscribe') return { stream_id: stream, subscription_id: sub,
            snapshot_sequence: events.length, first_sequence: 1, activities: [activity('Working snapshot', 3)], closed: false };
          if (args.request.operation === 'presentation.unsubscribe') return { unsubscribed: true };
          const after = args.request.after_sequence, selected = events.filter(e => e.sequence > after).slice(0, 2);
          const next = selected.at(-1)?.sequence ?? after;
          return { stream_id: stream, subscription_id: sub, events: selected, next_sequence: next,
            through_sequence: events.length, caught_up: next === events.length, coverage: 'complete', missing_range: null, closed: false };
        }
        const result = await original(command, args);
        if (command === 'pty_open') {
          streams.set(result, [log('Runner startup / account ready 🐸', 1, 'class:presentation-heading'),
            log('Warning: representative warning\nError: representative error\n' + Array.from({ length: 500 }, (_, i) => `Long log ${i}\n`).join('') + 'Completion: done', 2), activity('Working snapshot', 3)]);
          window.__nativeFixture.emit(result, '\r\n> /\r\nSuggestion secret\r\nTask Run · model hidden\r\n\x1b[?9001$p\x1b[5n');
        }
        if (command === 'runner_observe') result.presentationSupported = true;
        return result;
      };
    });
    await configure(page); await create(page);
    const output = page.locator('.runner-semantic');
    await expect(output).toContainText('Completion: done'); await expect(output).toContainText('Working snapshot');
    await expect(page.locator('.terminal-host')).toBeHidden();
    expect(await output.innerText()).not.toMatch(/> \/|Suggestion secret|Task Run · model/);
    await expect(page.locator('.semantic-record')).toHaveCount(2);
    const id = await page.evaluate(() => window.__semantic.requests.find(r => r.operation === 'presentation.read').id);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
    const writes = await page.evaluate(() => window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))));
    expect(writes.every(w => /^\x1b\[(?:\?9001;[12]\$y|0n)$/.test(w))).toBe(true);
    await page.locator('.xterm-helper-textarea').evaluate(input => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      input.dispatchEvent(new InputEvent('input', { data: 'x', bubbles: true }));
    });
    expect(await page.evaluate(() => window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))))).toEqual(writes);
    await output.evaluate(n => { n.scrollTop = 90; n.dispatchEvent(new Event('scroll')); });
    for (const text of ['Progress one', 'Progress two', 'Progress final']) {
      await page.evaluate(({ id, text }) => window.__semantic.update(id, text), { id, text });
      await expect(page.locator('.semantic-activity')).toHaveText(text);
      await expect(page.locator('.semantic-activity')).toHaveCount(1);
    }
    expect(await output.evaluate(n => n.scrollTop)).toBeCloseTo(90, 0);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('button', { name: 'Black', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
    expect(await output.evaluate(n => n.scrollTop)).toBeCloseTo(90, 0);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.locator('.runner-row .nav-row').first().click();
    await expect(output).toContainText('Runner startup');
    expect(await output.evaluate(n => n.scrollTop)).toBeCloseTo(90, 0);
    await page.evaluate(id => window.__semantic.update(id, '', true), id);
    await expect(page.locator('.semantic-activity')).toHaveCount(0);
    await expect(page.locator('.semantic-record')).toHaveCount(2);
    await page.evaluate(id => window.__semantic.append(id, '\nFinal completion'), id);
    await expect(output).toContainText('Final completion');
    expect(await output.evaluate(n => n.scrollTop)).toBeCloseTo(90, 0);
    await output.evaluate(n => { n.scrollTop = n.scrollHeight; n.dispatchEvent(new Event('scroll')); });
    await expect(page.locator('.generated-image-preview img').first()).toBeVisible();
    const box = await output.boundingBox(); expect(box.height).toBeGreaterThan(100);
    await info.attach('semantic-viewport-black', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await page.keyboard.press('Escape');
    await info.attach('semantic-viewport-light', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    const composer = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
    await expect(composer).toBeEnabled(); await composer.fill('semantic viewport fixture work'); await composer.press('Enter');
    await expect(composer).toHaveValue('', { timeout: 35000 });
    await page.evaluate(id => window.__semantic.fail(id), id);
    await expect(output.locator(':scope > .presentation-warning')).toContainText('Some Runner output is missing or unverified');
    await expect(output).toContainText('Final completion');
    await expect(page.locator('.terminal-host')).toBeHidden();
    await page.evaluate(id => window.__nativeFixture.exit(id, 1), id);
    await expect(output).toContainText('Runner output stream ended');
    await expect(output).toContainText('Final completion');
  });
  test('unsupported presentation retains terminal output with an explicit limitation', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
    await expect(page.locator('.presentation-limitation')).toContainText('does not offer supported semantic output');
    await expect(page.locator('.terminal-host')).toBeVisible();
    await expect(page.locator('.runner-semantic')).toHaveCount(0);
  });
}
