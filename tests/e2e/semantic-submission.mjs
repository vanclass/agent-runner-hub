export function registerSemanticSubmission({ test, expect, transport, configure, create }) {
  for (const single of [false, true]) test(`canonical submitted input exactly once Single Entry ${single}`, async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke, streams = new Map();
      native.invoke = async (command, args) => {
        if (command === 'runner_presentation') {
          const events = streams.get(args.id) ?? [], stream_id = 's-' + args.id, subscription_id = 'u-' + args.id;
          if (args.request.operation === 'presentation.subscribe') return { stream_id, subscription_id,
            snapshot_sequence: events.length, first_sequence: 1, activities: [], closed: false };
          if (args.request.operation === 'presentation.unsubscribe') return { unsubscribed: true };
          return { stream_id, subscription_id, events: events.filter(e => e.sequence > args.request.after_sequence),
            next_sequence: events.length, through_sequence: events.length, caught_up: true, coverage: 'complete', missing_range: null, closed: false };
        }
        const result = await original(command, args);
        if (command === 'pty_open') window.__nativeFixture.sessions.get(result).control.observation.commands.push({
          id: '/help', text: '/help', aliases: [], children: [], visible: true, enabled: true, description: '', disabled_reason: '' });
        if (command === 'runner_observe') result.presentationSupported = true;
        if (command === 'runner_feature' && args.request.request?.operation === 'work.submit' || command === 'runner_command') {
          const events = streams.get(args.id) ?? []; streams.set(args.id, events);
          const text = command === 'runner_command' ? 'Runner /help EventPresentation command output' : args.request.request.instruction;
          if (command === 'runner_command') Object.assign(window.__nativeFixture.sessions.get(args.id).control.results[0], { state: 'accepted', phase: 'completed' });
          const sequence = events.length + 1;
          events.push({ type: 'log', sequence, record_id: sequence, text, spans: [{ text, style: 'class:submitted-input' }],
            start_offset: 0, end_offset: Array.from(text).length, final_fragment: true, terminate_line: true, line_ending: 'ensure' });
        }
        return result;
      };
    });
    await configure(page); if (!single) await create(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    const input = page.locator('textarea[data-instruction]');
    const draft = 'Canonical submitted instruction 한국어\n' + 'English 한국어 multiline\n'.repeat(24);
    await expect(input).toBeEnabled(); await input.fill(draft); await input.press('Enter');
    await expect(page.locator('.semantic-logs')).toContainText('Canonical submitted instruction');
    await expect(input).toHaveValue('', { timeout: 35000 });
    await expect(page.locator('.semantic-record')).toHaveCount(1);
    await page.waitForTimeout(1100);
    await expect(page.locator('.semantic-record')).toHaveCount(1);
    expect((await page.locator('.semantic-logs').textContent()).split(draft).length - 1).toBe(1);
    await expect(input).toBeEnabled(); await input.fill('/help'); await input.press('Enter');
    await expect(page.locator('.semantic-logs')).toContainText('Runner /help EventPresentation command output');
    await expect(input).toHaveValue('');
    await expect(page.locator('.semantic-record')).toHaveCount(2);
    await expect(page.locator('.terminal-host')).toBeHidden();
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
