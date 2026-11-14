export function registerBriefSubmission({ test, expect, transport, configure, create }) {
  async function feedback(page, tab, key) {
    await page.keyboard.press('Control+Home');
    await expect(page.locator('.hub-log-records')).toContainText(key, { timeout: 35000 });
    if (tab) await page.keyboard.press('Control+End');
  }
  const input = page => page.locator('.composer-area textarea[data-instruction]');
  async function ready(page, tab, options = {}) {
    await transport(page, undefined, { auto: true, work: true, brief: 'accepted', ...options });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    if (tab) await create(page);
    const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
    await mode.focus();
    await expect(mode).toBeEnabled();
    await mode.selectOption(JSON.stringify('issue-run'));
  }
  for (const tab of [false, true]) {
    const path = tab ? 'Runner tab' : 'Single Entry';
    test(`unified composer ${path} has one input and empty Ctrl+Enter has no effects`, async ({ page }) => {
      await ready(page, tab);
      await expect(page.locator('.composer-area textarea')).toHaveCount(1);
      await input(page).press('Control+Enter');
      expect(await page.evaluate(() => {
        const s = window.__nativeFixture.sessions.get('pty-1');
        return { staging: s.briefRequests ?? [], run: s.run.requests };
      })).toEqual({ staging: [], run: [] });
      await expect(page.locator('.output-label, .composer-note, .control-status')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Release unsent assignment' })).toHaveCount(0);
    });
    for (const body of ['과검증 과설계에 주의해']) {
      test(`Brief Run ${path} stages exact unified Korean instructions (${body ? 'both' : 'Run only'})`, async ({ page }) => {
        await ready(page, tab, body ? {} : { brief: 'unsupported' });
        const text = body;
        await input(page).fill(body);
        const run = input(page);
        await run.press('Control+Enter');
        await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests
          .filter(r => r.operation === 'run.invoke')), { timeout: 35000 }).toEqual([{ operation: 'run.invoke', api_version: 1 }]);
        if (!tab) await page.keyboard.press('Control+Home');
        await expect(input(page)).toHaveValue(''); await expect(run).toHaveValue('');
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests ?? []))
          .toEqual(body ? [{ operation: 'brief.stage', api_version: 1, body }] : []);
      });
    }
    for (const body of ['Brief without work submission']) {
      test(`Brief Run ${path} without work.submit ${body ? 'with Brief' : 'Run only'}`, async ({ page }) => {
        await ready(page, tab, { workOperations: ['work.list', 'work.observe', 'work.status'], runResult: 'pending',
          ...(body ? {} : { brief: 'unsupported' }) });
        const run = input(page);
        await input(page).fill(body); await run.press('Control+Enter');
        await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests
          .filter(r => r.operation === 'run.status').length), { timeout: 35000 }).toBeGreaterThan(0);
        if (!tab) await page.keyboard.press('Control+Home');
        await expect(input(page)).toBeDisabled(); await expect(input(page)).toHaveValue(body);
        await expect(run).toHaveValue(body);
        await page.keyboard.press('Control+Enter');
        await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').run.mode = 'started'; });
        await feedback(page, tab, 'brief.requested');
        if (!tab) await page.keyboard.press('Control+Home');
        await expect(input(page)).toHaveValue(''); await expect(run).toHaveValue('');
        await expect(input(page)).toBeEnabled();
        const evidence = await page.evaluate(() => {
          const n = window.__nativeFixture, s = n.sessions.get('pty-1');
          return { runs: s.run.requests, staging: s.briefRequests ?? [], work: s.feature.requests,
            mode: s.feature.config.current.run_mode, writes: n.writes, commands: n.commands };
        });
        expect(evidence.runs.filter(r => r.operation === 'run.invoke'))
          .toEqual([{ operation: 'run.invoke', api_version: 1 }]);
        expect(evidence.runs.filter(r => r.operation === 'run.status').every(r => r.invocation_request_id === 8001)).toBe(true);
        expect(evidence.staging).toEqual(body ? [{ operation: 'brief.stage', api_version: 1, body }] : []);
        expect(evidence.mode).toBe('issue-run');
        expect(evidence.work.filter(r => r.operation === 'work.submit')).toEqual([]);
        expect(evidence.writes).toEqual([]); expect(evidence.commands).toEqual([]);
        await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toBeEnabled({ timeout: 35000 });
        await input(page).fill('ordinary Send remains unavailable'); await input(page).press('Enter');
        if (!tab) await page.keyboard.press('Control+Home');
        await feedback(page, tab, 'work.unavailable');
        await expect(input(page)).toHaveValue('ordinary Send remains unavailable');
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
          .filter(r => r.operation === 'work.submit'))).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests
          .filter(r => r.operation === 'run.invoke'))).toHaveLength(1);
        expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      });
    }
    for (const runResult of ['invoke-only', 'status-only']) for (const body of ['retained Brief']) {
      test(`Brief Run ${path} ${runResult} ${body ? 'with Brief' : 'Run only'} leaves ordinary work usable`, async ({ page }) => {
        await ready(page, tab, { runResult });
        const run = input(page);
        await input(page).fill(body); await run.press('Control+Enter');
        if (!tab) await page.keyboard.press('Control+Home');
        await feedback(page, tab, 'brief.unavailable');
        await expect(input(page)).toHaveValue(body); await expect(run).toHaveValue(body);
        if (!tab) {
          await page.getByRole('button', { name: 'Verified idle Runner 1', exact: true }).click();
        }
        await expect(input(page)).toBeEnabled({ timeout: 35000 });
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests)).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests ?? [])).toEqual([]);
        const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
        await expect(mode).toBeEnabled({ timeout: 35000 }); await mode.selectOption(JSON.stringify('task-run'));
        await input(page).fill('ordinary work after unsupported Run'); await input(page).press('Enter');
        await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
          .filter(r => r.operation === 'work.submit'))).toMatchObject([{ instruction: 'ordinary work after unsupported Run' }]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.current.run_mode)).toBe('task-run');
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests)).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests ?? [])).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      });
    }
    test(`Brief Run ${path} preserves exact multiline body and waits for committed start`, async ({ page }, info) => {
      await ready(page, tab, { runResult: 'pending' });
      const body = '  한글 🌍\n    indented\t \n/run remains Brief text  \n\n';
      await input(page).fill(body); await input(page).focus();
      await page.keyboard.down('Control'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
      await page.keyboard.up('Enter'); await page.keyboard.up('Control');
      if (!tab) await page.keyboard.press('Control+Home');
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests
        .filter(r => r.operation === 'run.status').length), { timeout: 35000 }).toBeGreaterThan(0);
      await expect(input(page)).toBeDisabled();
      await expect(input(page)).toHaveValue(body);
      await feedback(page, tab, 'brief.pending');
      const original = await page.evaluate(() => {
        const n = window.__nativeFixture, s = n.sessions.get('pty-1');
        return { body: s.briefRequests, commands: n.commands, run: s.run.requests, work: s.feature.requests, writes: n.writes, mode: s.feature.config.current.run_mode };
      });
      expect(original.body).toEqual([{ operation: 'brief.stage', api_version: 1, body }]);
      expect(original.commands).toEqual([]);
      expect(original.run.filter(r => r.operation === 'run.invoke')).toEqual([{ operation: 'run.invoke', api_version: 1 }]);
      expect(original.run.filter(r => r.operation === 'run.status').every(r => r.invocation_request_id === 8001)).toBe(true);
      expect(original.mode).toBe('issue-run');
      expect(original.work.filter(r => r.operation === 'work.submit')).toEqual([]); expect(original.writes).toEqual([]);
      await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').run.mode = 'started'; });
      await feedback(page, tab, 'brief.requested');
      if (!tab) await page.keyboard.press('Control+Home');
      await expect(input(page)).toHaveValue('');
      await expect(input(page)).toBeEnabled();
      await info.attach('brief-run-confirmed', { body: await page.screenshot(), contentType: 'image/png' });
      await page.clock.install();
      for (const lifecycle of ['WAITING_FOR_HUMAN', 'PAUSED', 'RUNNING', 'FAILED']) {
        await page.evaluate(lifecycle => {
          const s = window.__nativeFixture.sessions.get('pty-1');
          Object.assign(s.control.observation.execution, { lifecycle_state: lifecycle,
            owned_execution_alive: lifecycle !== 'FAILED', workflow_kind: 'issue-run' });
          Object.assign(s.control.observation.attention, { foreground_interaction_active: lifecycle === 'WAITING_FOR_HUMAN',
            suspension_status: lifecycle === 'PAUSED' ? 'paused' : 'inactive' });
        }, lifecycle);
        await page.clock.runFor(70000);
        await expect(input(page)).toHaveValue('');
        await feedback(page, tab, 'brief.requested');
      }
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests.filter(r => r.operation === 'run.invoke'))).toHaveLength(1);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    });
    for (const brief of ['rejected', 'unknown', 'unsupported', 'malformed', 'crossed', 'disconnected']) {
      test(`Brief Run ${path} never runs after ${brief} staging`, async ({ page }) => {
        await ready(page, tab, { brief });
        await input(page).fill('  retained 한글\ntrailing  \n'); await input(page).press('Control+Enter');
        if (!tab) await page.keyboard.press('Control+Home');
        const label = brief === 'rejected' ? 'brief.stageRejected' : brief === 'unsupported' ? 'brief.unavailable' : 'brief.stageUnknown';
        await feedback(page, tab, label);
        if (!tab) await page.keyboard.press('Control+Home');
        await expect(input(page)).toHaveValue('  retained 한글\ntrailing  \n');
        if (!['rejected', 'unsupported'].includes(brief)) await page.keyboard.press('Control+Enter');
        expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests)).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests?.length ?? 0)).toBe(brief === 'unsupported' ? 0 : 1);
        expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      });
    }
    test(`Brief Run ${path} keeps staged Brief when Run is rejected`, async ({ page }) => {
      await ready(page, tab, { runResult: 'rejected' });
      await input(page).fill('staged draft'); await input(page).press('Control+Enter');
      if (!tab) await page.keyboard.press('Control+Home');
      await feedback(page, tab, 'brief.runRejected');
      if (!tab) await page.keyboard.press('Control+Home');
      await expect(input(page)).toHaveValue('staged draft');
      await page.keyboard.press('Control+Enter');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests.filter(r => r.operation === 'run.invoke').length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests.length)).toBe(1);
    });
    test(`composer Enter ${path} shares Send and preserves editing composition and mode guards`, async ({ page }) => {
      await ready(page, tab);
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
      await input(page).fill('first'); await input(page).press('Shift+Enter');
      await page.keyboard.type('second'); await expect(input(page)).toHaveValue('first\nsecond');
      await input(page).press('Home'); await expect(input(page)).toBeFocused();
      await input(page).press('Control+Enter'); await expect(input(page)).toHaveValue('first\nsecond');
      await input(page).evaluate(node => {
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
      });
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit'))).toEqual([]);
      await input(page).press('Enter');
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit')))
        .toMatchObject([{ instruction: 'first\nsecond' }]);
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      if (!tab) await page.keyboard.press('Control+Home');
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
    });
    for (const [runResult, label] of [['human', 'brief.attention'], ['paused', 'brief.attention'],
      ['not-started', 'brief.notStarted'], ['returned', 'brief.ownerReturned'],
      ['malformed', 'brief.runUnknown'], ['crossed', 'brief.runUnknown'], ['lost-admission', 'brief.runUnknown'],
      ['unsupported', 'brief.unavailable']]) {
      test(`Brief Run ${path} retains ownership after ${runResult}`, async ({ page }) => {
        await ready(page, tab, { runResult });
        await input(page).fill('retained invocation'); await input(page).press('Control+Enter');
        if (!tab) await page.keyboard.press('Control+Home');
        await feedback(page, tab, label);
        await expect(input(page)).toHaveValue('retained invocation');
        if (runResult !== 'unsupported') await page.keyboard.press('Control+Enter');
        const requests = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests);
        expect(requests.filter(r => r.operation === 'run.invoke').length).toBe(runResult === 'unsupported' ? 0 : 1);
        expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
        expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      });
    }
    test(`Brief Run ${path} never replays an uncertain Run`, async ({ page }) => {
      await ready(page, tab, { runResult: 'outcome-unknown' });
      await input(page).fill('retained after Run'); await input(page).press('Control+Enter');
      if (!tab) await page.keyboard.press('Control+Home');
      await feedback(page, tab, 'brief.runUnknown');
      await expect(input(page)).toHaveValue('retained after Run');
      await page.keyboard.press('Control+Enter');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').run.requests.filter(r => r.operation === 'run.invoke').length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').briefRequests.length)).toBe(1);
    });
  }
  test('Brief Run never falls through to PTY when foreground ownership changes during verification', async ({ page }) => {
    await ready(page, true);
    await input(page).fill('Brief must stay out of PTY'); await input(page).press('Control+Enter');
    await page.evaluate(() => {
      window.__nativeFixture.sessions.get('pty-1').control.observation.attention.foreground_interaction_active = true;
    });
    await page.keyboard.press('Control+Home');
    await expect(page.locator('.hub-log-records')).toContainText(/runtime.entry.attentionUnsettled|interaction.usePanel/);
    await page.keyboard.press('Control+End');
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
