export function registerRunnerDiscovery({ test, expect, transport, configure, create, records }) {
  const row = (page, name) => page.locator('.runner-row').filter({ has: page.getByText(name, { exact: true }) });
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  async function publish(page, id, changes = {}) {
    await page.evaluate(async ({ id, changes }) => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
      const event = Math.max(0, ...[...fixture.observations.values()].map(w => w.event_id)) + 1;
      const previous = fixture.observations.get(`terminal:${id}`);
      fixture.observations.set(`terminal:${id}`, terminalWork(id, event, { ...previous, ...changes, event_id: event }));
    }, { id, changes });
  }
  for (const route of ['composer', 'typing']) {
    test(`runner discovery ${route} keeps PTY input and discovers sequential inactive completion`, async ({ page }, info) => {
      await transport(page, undefined, { auto: true, work: true, workDiscovery: true });
      await configure(page); await create(page);
      const own = row(page, 'Runner 1');
      for (let n = 1; n <= 2; n++) {
        const instruction = `short instruction ${n}`;
        if (route === 'composer') {
          await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill(instruction);
          await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
          await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
        } else {
          await page.locator('.xterm-helper-textarea').focus();
          await page.keyboard.type(instruction); await page.keyboard.press('Enter');
        }
        // Synthetic authenticated Runner evidence; PTY bytes themselves establish no work.
        await home(page);
        if (n === 1) {
          await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\r\nTask completed (untrusted terminal text)\r\n'));
          await page.waitForTimeout(1700);
          await expect(own.locator('.status-dot.completed')).toHaveCount(0);
        }
        await publish(page, n, { state: 'succeeded', terminal: true, outcome: 'succeeded' });
        await expect(own.locator('.status-dot.completed')).toBeVisible();
        await expect(own.locator('.unread-completion')).toBeVisible();
        if (n === 1) await create(page);
        else await row(page, 'Runner 2').locator('.nav-row').click();
        await expect(own.locator('.unread-completion')).toBeVisible();
        await info.attach(`${route}-background-${n}`, { body: await page.screenshot(), contentType: 'image/png' });
        await own.locator('.nav-row').click();
        await expect(own.locator('.unread-completion')).toHaveCount(0);
      }
      const evidence = await page.evaluate(() => {
        const native = window.__nativeFixture, fixture = native.sessions.get('pty-1').feature;
        return { requests: fixture.requests, writes: native.writes,
          saved: localStorage.getItem('agent-runner-hub.workspace.v1') };
      });
      expect(evidence.requests.filter(r => r.operation === 'work.submit')).toHaveLength(0);
      expect(evidence.requests.filter(r => r.operation === 'work.status')).toHaveLength(0);
      expect(evidence.requests.some(r => r.operation === 'work.list' && r.after_event_id === 0)).toBe(true);
      const input = records(evidence.writes, 'pty-1').filter(r => r.down);
      expect(input.filter(r => r.vk === 13)).toHaveLength(2);
      expect(input.map(r => String.fromCodePoint(r.char)).join('')).toBe('short instruction 1\rshort instruction 2\r');
      expect(evidence.saved).not.toMatch(/observation_id|submission_request|unread|short instruction/);
    });
  }
  test('runner discovery API route keeps one execution and one unread notification', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, workDiscovery: true });
    await configure(page);
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('single API work');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).evaluate(button => {
      button.addEventListener('click', () => {
        window.__assignmentStartIndex = window.__nativeFixture.sessions.get('pty-1').feature.requests.length;
      }, { once: true });
    });
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    await home(page);
    await page.evaluate(() => {
      const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
      fixture.mode = 'dispatch';
      Object.assign(fixture.work, { state: 'succeeded', terminal: true, outcome: 'succeeded', event_id: fixture.work.event_id + 1 });
      fixture.observations.set(fixture.work.observation_id, structuredClone(fixture.work));
    });
    const own = row(page, 'Runner 1');
    await expect(own.locator('.status-dot.completed')).toBeVisible();
    await expect(own.locator('.unread-completion')).toBeVisible();
    await own.locator('.nav-row').click(); await home(page);
    await page.waitForTimeout(2200);
    await expect(own.locator('.unread-completion')).toHaveCount(0);
    const requests = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests);
    expect(requests.filter(r => r.operation === 'work.submit')).toHaveLength(1);
    const start = await page.evaluate(() => window.__assignmentStartIndex);
    expect(requests.slice(start, requests.findIndex(r => r.operation === 'work.submit'))).toEqual([]);
    expect(requests.some(r => r.operation === 'work.list')).toBe(true);
  });
  test('runner discovery pending reads yield to terminal, configuration, references and images', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, workDiscovery: true, generatedImages: [] });
    await configure(page); await create(page);
    await page.evaluate(() => {
      const fixture = window.__nativeFixture.sessions.get('pty-1').feature, send = fixture.submit.bind(fixture);
      const gate = new Promise(resolve => { window.__releaseRead = resolve; });
      fixture.submit = async request => {
        if (request.operation === 'work.list') { window.__readHeld = true; await gate; }
        return send(request);
      };
    });
    await expect.poll(() => page.evaluate(() => window.__readHeld)).toBe(true);
    await expect(page.locator('.shortcut-bar').getByRole('button', { name: 'Status /status', exact: true })).toBeEnabled();
    await expect(page.locator('.runner-config')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Inspect settings and options', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Draft Account', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Refresh images', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh images', exact: true })).toBeEnabled();
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('input during discovery');
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.some(r => r.id === 'pty-1'))).toBe(true);
    await page.evaluate(() => window.__releaseRead());
  });
  test('runner discovery foreground confirmation stays in terminal input and keeps the composer draft', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, workDiscovery: true });
    await configure(page); await create(page);
    await publish(page, 1, { state: 'suspended', outcome: 'interrupted' });
    await expect(row(page, 'Runner 1').locator('.status-dot.attention')).toBeVisible();
    await page.evaluate(() => {
      const control = window.__nativeFixture.sessions.get('pty-1').control;
      control.observation.attention.foreground_interaction_active = true;
    });
    await page.waitForTimeout(600);
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('confirmation answer');
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Finish the Runner terminal interaction' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('confirmation answer');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('yes'); await page.keyboard.press('Enter');
    const input = records(await page.evaluate(() => window.__nativeFixture.writes), 'pty-1').filter(r => r.down);
    expect(input.map(r => String.fromCodePoint(r.char)).join('')).toBe('yes\r');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
      .filter(r => r.operation === 'work.submit'))).toEqual([]);
  });
}
