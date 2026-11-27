// Structured selection/confirmation presentation is deferred; canonical attention still blocks input.
export function registerRunnerInteractions({ test, expect, transport, configure, create }) {
  for (const state of ['active', 'pending-command', 'disconnected']) {
    test('Runner workspace preserves canonical foreground guards: ' + state, async ({ page }) => {
      await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
      await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
      await expect(page.locator('.runner-interaction, .runner-work-status, .runner-instructions, .terminal-tools')).toHaveCount(0);
      await page.evaluate(state => {
        const s = window.__nativeFixture.sessions.get('pty-1');
        s.control.observation.attention.foreground_interaction_active = state === 'active';
        s.control.results = state === 'pending-command' ? [{ id: 8000, command: '/run', state: 'pending-interaction' }] : [];
        if (state === 'disconnected') s.control.state = 'disconnected';
      }, state);
      if (state !== 'disconnected') await expect(page.locator('textarea[data-instruction]')).toBeDisabled();
      expect(await page.locator('.workspace > *').evaluateAll(nodes => nodes.map(n => n.className)))
        .toEqual(['output', 'runner-quick-settings', 'workspace-context', 'composer-area runner-composer', 'hub-activity']);
      await expect(page.locator('.runner-interaction, .runner-work-status, .runner-instructions, .terminal-tools')).toHaveCount(0);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests)
        .filter(r => r.operation.startsWith('interaction.')))).toEqual([]);
    });
  }
  test('terminal read-only origin boundary preserves internal replies and browser navigation', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
    const input = page.locator('.terminal-host textarea');
    await expect(input).toHaveAttribute('readonly', '');
    await input.focus();
    for (const key of ['a', 'Enter', 'Control+c', 'Control+v', 'Shift+Enter']) await page.keyboard.press(key);
    await input.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { data: '世', bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { data: '\x1b[0n', bubbles: true, inputType: 'insertCompositionText' }));
      el.dispatchEvent(new CompositionEvent('compositionend', { data: '世界', bubbles: true }));
      const data = new DataTransfer(); data.setData('text/plain', '\x1b[0n');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b[5n\x1b[?9001$p\r\nINTERNAL-REPLIES\r\n'));
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))).join(''))).toContain('\x1b[0n');
    expect(await page.evaluate(() => window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))).join(''))).toContain('\x1b[?9001;1$y');
    const prevented = await input.evaluate(el => {
      const event = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await page.keyboard.press('Control+Home');
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+Shift+Home');
    await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toBeVisible();
  });
}
