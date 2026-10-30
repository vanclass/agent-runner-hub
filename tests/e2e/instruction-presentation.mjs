const instruction = '개구리 이미지를 보여줄래?';
export function registerInstructionPresentation({ test, expect, transport, configure, create }) {
  const entries = page => page.locator('.runner-instruction');
  const composer = page => page.getByRole('textbox', { name: 'Runner instructions', exact: true });
  const send = page => page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  async function ready(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options }); await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'task-run' });
  }
  for (const route of ['tab', 'Single Entry']) {
    test(`instruction presentation ${route} retains exact text once across discovery tabs and rerenders`, async ({ page }, info) => {
      await ready(page, { workDiscovery: true });
      if (route === 'tab') { await create(page); await composer(page).fill(instruction); await send(page); }
      else {
        await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill(instruction);
        await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
      }
      await expect(entries(page)).toHaveCount(1, { timeout: 35000 });
      expect(await entries(page).locator('pre').textContent()).toBe(instruction);
      await expect(entries(page)).toContainText('Verified start event', { timeout: 35000 }); await expect(composer(page)).toHaveValue('');
      await page.getByRole('button', { name: 'Refresh work status', exact: true }).click();
      await home(page); await create(page); await expect(entries(page)).toHaveCount(0);
      await page.locator('.runner-row .nav-row').first().click();
      await page.locator('.app-settings-trigger').click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko'); await page.keyboard.press('Escape');
      await expect(entries(page)).toHaveCount(1); expect(await entries(page).locator('pre').textContent()).toBe(instruction);
      const evidence = await page.evaluate(() => {
        const n = window.__nativeFixture, f = n.sessions.get('pty-1').feature;
        return { submits: f.requests.filter(r => r.operation === 'work.submit'), writes: n.writes, commands: n.commands,
          registrations: n.referenceRequests.filter(r => r.request.operation === 'references.register'), stored: Object.values(localStorage).join('\n') };
      });
      expect(evidence.submits).toEqual([{ operation: 'work.submit', api_version: 1, instruction }]);
      expect(evidence.writes).toEqual([]); expect(evidence.commands).toEqual([]); expect(evidence.registrations).toEqual([]);
      expect(evidence.stored).not.toContain(instruction);
      await info.attach('visible-instruction', { body: await page.screenshot(), contentType: 'image/png' });
      await page.reload(); await expect(page.locator('.runner-row')).toHaveCount(2);
      await page.locator('.runner-row .nav-row').first().click(); await expect(entries(page)).toHaveCount(0);
    });
  }
  test('instruction presentation distinguishes repeated text submitted under new identities', async ({ page }) => {
    await ready(page, { workMode: 'succeeded', workDiscovery: true }); await create(page);
    for (let count = 1; count <= 2; count++) {
      await composer(page).fill(instruction); await send(page);
      await expect(composer(page)).toHaveValue('', { timeout: 35000 });
      await expect(entries(page)).toHaveCount(count);
      await expect(entries(page).last()).toContainText('Succeeded');
    }
    expect(await entries(page).locator('pre').allTextContents()).toEqual([instruction, instruction]);
    const originalIds = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.features.results
      .filter(r => r.operation === 'work.submit').map(r => r.id));
    expect(new Set(originalIds).size).toBe(2);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
  test('instruction presentation counts reference receipts independently of repeated files output', async ({ page }) => {
    await ready(page); await create(page);
    await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '/files\r\n'.repeat(7)));
    await composer(page).fill(instruction); await send(page);
    await expect(entries(page)).toContainText('Verified start event', { timeout: 35000 });
    const evidence = await page.evaluate(() => {
      const n = window.__nativeFixture, s = n.sessions.get('pty-1');
      return { requests: n.referenceRequests.filter(r => r.request.operation === 'references.register'),
        receipts: s.control.references.results.filter(r => r.state === 'registered'), inventory: s.items,
        delivered: n.deliveredSets, writes: n.writes, commands: n.commands };
    });
    expect(evidence.requests).toHaveLength(1); expect(evidence.receipts).toHaveLength(1);
    expect(evidence.receipts[0].registrationStatus).toBe('registered'); expect(evidence.inventory).toHaveLength(1);
    const stable = evidence.receipts[0].reference.reference_id;
    expect(evidence.inventory[0].reference_id).toBe(stable); expect(evidence.delivered[0].ids).toEqual([stable]);
    expect(evidence.writes).toEqual([]); expect(evidence.commands).toEqual([]);
    expect((await page.locator('.xterm-rows').innerText()).match(/\/files/g)).toHaveLength(7);
  });
  for (const mode of ['rejected', 'unknown', 'not-sent', 'admitted', 'queued']) {
    test(`instruction presentation preserves ${mode} and updates the original entry`, async ({ page }) => {
      await ready(page, { workMode: ['not-sent', 'queued'].includes(mode) ? 'started' : mode }); await create(page);
      await page.evaluate(mode => { const f = window.__nativeFixture.sessions.get('pty-1').feature;
        if (mode === 'not-sent') f.fault = 'not-sent'; if (mode === 'queued') f.holdSubmit = true; }, mode);
      const original = '  ' + instruction + '\n안녕 🌍\n';
      await composer(page).fill(original); await send(page); await expect(entries(page)).toHaveCount(1, { timeout: 35000 });
      expect(await entries(page).locator('pre').textContent()).toBe(original);
      await expect(entries(page)).toContainText(mode === 'queued' ? 'Queued' : mode === 'admitted' ? 'Admitted · start unconfirmed'
        : mode === 'unknown' ? 'Outcome unknown' : mode === 'rejected' ? 'Rejected' : 'Not sent');
      await expect(entries(page)).toContainText('Start unconfirmed'); await expect(composer(page)).toHaveValue(original);
      if (['queued', 'admitted', 'unknown'].includes(mode)) {
        await page.evaluate(mode => { const f = window.__nativeFixture.sessions.get('pty-1').feature;
          f.mode = 'started'; if (mode === 'queued') f.releaseSubmit(); }, mode);
        if (mode === 'unknown') await page.getByRole('button', { name: 'Refresh work status', exact: true }).click();
        await expect(composer(page)).toHaveValue('', { timeout: 30000 }); await expect(entries(page)).toContainText('Verified start event');
      }
      await expect(entries(page)).toHaveCount(1); expect(await entries(page).locator('pre').textContent()).toBe(original);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    });
  }
  for (const outcome of ['accepted', 'rejected', 'outcome-unknown']) {
    test(`instruction presentation keeps seven pre-readiness output lines separate from authenticated /files ${outcome}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true });
      await page.addInitScript(() => {
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        native.invoke = async (command, args) => {
          const result = await invoke(command, args);
          if (command === 'pty_open') {
            const control = window.__nativeFixture.sessions.get(result).control;
            control.state = 'connecting';
            for (const command of control.observation.commands) for (const child of command.children) child.aliases ??= [];
            window.__nativeFixture.emit(result, '/files\r\n'.repeat(7) + '\x1b[?9001$p\x1b[5n');
          }
          if (command === 'runner_command') {
            window.__nativeFixture.sessions.get(args.id).control.results[0].phase = 'queued';
          }
          return result;
        };
      });
      await configure(page);
      const preparedIds = await page.evaluate(() => [...window.__nativeFixture.sessions.keys()]);
      await create(page);
      await expect.poll(() => page.locator('.xterm-rows').innerText()).toContain('/files');
      expect((await page.locator('.xterm-rows').innerText()).match(/\/files/g)).toHaveLength(7);
      const createdIds = await page.evaluate(prepared => [...window.__nativeFixture.sessions.keys()]
        .filter(id => !prepared.includes(id)), preparedIds);
      expect(createdIds).toHaveLength(1);
      const [sessionId] = createdIds;
      const before = await page.evaluate(() => ({ writes: window.__nativeFixture.writes.map(w => new TextDecoder().decode(new Uint8Array(w.bytes))),
        commands: window.__nativeFixture.commands, references: window.__nativeFixture.referenceRequests,
        work: [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests) }));
      expect(before.writes.length).toBeGreaterThan(0);
      expect(before.writes.every(s => /^\x1b\[(?:\?9001;[12]\$y|0n)$/.test(s))).toBe(true);
      expect(before.commands).toEqual([]); expect(before.references).toEqual([]); expect(before.work).toEqual([]);
      await page.evaluate(id => { window.__nativeFixture.sessions.get(id).control.state = 'ready'; }, sessionId);
      await page.waitForFunction(id => JSON.parse(window.__nativeFixture.observed.get(id) || '{}').state === 'ready', sessionId);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })
        .getByRole('option', { name: 'm0', exact: true })).toBeAttached();
      await expect(composer(page)).toBeEnabled(); await composer(page).fill('/files'); await send(page);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.commands))
        .toEqual([{ id: sessionId, command: '/files' }]);
      await expect(composer(page)).toHaveValue('/files'); await expect(composer(page)).toBeDisabled();
      if (outcome === 'accepted') {
        await page.evaluate(id => { window.__nativeFixture.sessions.get(id).control.results[0].state = 'accepted'; }, sessionId);
        await page.waitForTimeout(650);
        await expect(composer(page)).toHaveValue('/files');
      }
      await page.evaluate(({ sessionId, outcome }) => {
        const result = window.__nativeFixture.sessions.get(sessionId).control.results[0];
        Object.assign(result, { state: outcome, phase: 'completed' });
      }, { sessionId, outcome });
      await expect(composer(page)).toHaveValue(outcome === 'accepted' ? '' : '/files');
      if (outcome === 'outcome-unknown') {
        await expect(composer(page)).toBeDisabled();
        await composer(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
        await page.getByRole('button', { name: 'Send instruction', exact: true }).dispatchEvent('click');
      } else await expect(composer(page)).toBeEnabled();
      await page.waitForTimeout(650);
      await expect(composer(page)).toHaveValue(outcome === 'accepted' ? '' : '/files');
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([{ id: sessionId, command: '/files' }]);
      const afterWrites = await page.evaluate(() => window.__nativeFixture.writes
        .map(w => new TextDecoder().decode(new Uint8Array(w.bytes))));
      expect(afterWrites).toEqual(before.writes);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests))).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toEqual([]); await expect(entries(page)).toHaveCount(0);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()]
        .flatMap(s => s.control.references.results))).toEqual([]);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.items))).toEqual([]);
      expect((await page.locator('.xterm-rows').innerText()).match(/\/files/g)).toHaveLength(7);
    });
  }
}
