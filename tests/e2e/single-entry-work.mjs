export function registerSingleEntryWork({ test, expect, transport, configure, create }) {
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  const assign = page => page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  async function ready(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options });
    await configure(page);
    await expect(page.getByRole('status').filter({ hasText: 'Spare Runner ready.' })).toBeVisible();
  }
  test('work Single Entry defaults to a promoted spare focuses immediately and submits exactly once', async ({ page }, info) => {
    await ready(page);
    await expect(page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' })).not.toBeChecked();
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('one instruction\n안녕 🌍');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).evaluate(b => { b.click(); b.click(); });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runner 1');
    await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event: 3');
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
    await home(page);
    await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'Runner verified start' })).toBeVisible();
    await page.getByText('Assignment evidence', { exact: true }).click();
    await expect(page.getByText(/Promoted Runner 1/)).toBeVisible();
    await expect(page.locator('.xterm')).toHaveCount(0);
    const receipt = await page.evaluate(() => ({ requests: window.__nativeFixture.sessions.get('pty-1').feature.requests,
      original: window.__nativeFixture.sessions.get('pty-1').feature.work.submission_request_id,
      count: window.__nativeFixture.count(), writes: window.__nativeFixture.writes,
      tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs }));
    expect(receipt.requests.filter(r => r.operation === 'work.submit')).toHaveLength(1);
    expect(receipt.requests.find(r => r.operation === 'work.submit').instruction).toBe('one instruction\n안녕 🌍');
    expect(receipt.requests.filter(r => r.operation === 'work.status').every(r => r.submission_request_id === receipt.original)).toBeTruthy();
    expect(receipt.writes).toEqual([]);
    expect(receipt.count).toBe(2); expect(receipt.tabs).toHaveLength(1);
    await info.attach('single-entry-work-start-summary', { body: await page.screenshot(), contentType: 'image/png' });
  });
  test('work Single Entry explicit reuse preserves the selected visible process while always-new ignores it', async ({ page }) => {
    await ready(page); await create(page); await home(page);
    await page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' }).check();
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('reuse once');
    await assign(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runner 1');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
    await home(page); await page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' }).uncheck();
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('always new');
    await assign(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runner 2');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-2').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry.allocationPolicy)).toBe('always-new');
  });
  test('work Single Entry falls back to supported fresh launch when no spare is ready', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true }); await page.goto('/');
    const result = await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = new RunnerSessions();
      owner.entry.setDraft('fresh launch once');
      await owner.entry.submit('/fixture/install');
      const session = owner.get(owner.entry.runnerId);
      const result = { count: window.__nativeFixture.count(), phase: owner.entry.phase,
        id: session.control.sessionId, starts: session.control.work.current.work.started_event_id };
      await owner.dispose(); return result;
    });
    expect(result).toEqual({ count: 1, phase: 'delivered', id: 'pty-1', starts: 3 });
  });
  test('work Single Entry simultaneous reuse assignments reserve distinct exact sessions', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true }); await page.goto('/');
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      window.__owners = new RunnerSessions();
      await window.__owners.create('/fixture/install').launched;
    });
    await expect.poll(() => page.evaluate(() => window.__owners.get(window.__owners.getSnapshot()[0].id).assignmentAvailable)).toBe(true);
    const result = await page.evaluate(async () => {
      const { SingleEntry } = await import('/src/hub/singleEntry.ts');
      const owner = window.__owners, list = () => owner.getSnapshot().map(v => owner.get(v.id));
      const entries = [1, 2].map(() => new SingleEntry(list, (root, token) => owner.create(root, token),
        () => {}, { allocationPolicy: 'reuse-idle' }));
      entries[0].setDraft('first'); entries[1].setDraft('second');
      await Promise.all(entries.map(e => e.submit('/fixture/install')));
      const result = { phases: entries.map(e => e.phase), ids: entries.map(e => e.runnerId),
        submits: [...window.__nativeFixture.sessions.values()].map(s => s.feature.requests.filter(r => r.operation === 'work.submit').length) };
      await owner.dispose(); return result;
    });
    expect(result.phases).toEqual(['delivered', 'delivered']);
    expect(new Set(result.ids).size).toBe(2); expect(result.submits).toEqual([1, 1]);
  });
  test('work Single Entry ignores terminal success text until canonical start arrives', async ({ page }) => {
    await ready(page, { workMode: 'admitted' });
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('one waiting instruction'); await assign(page);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Admitted · start unconfirmed');
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', 'TASK COMPLETE: synthetic terminal text\r\n'));
    await home(page);
    await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('one waiting instruction');
    await expect(page.getByRole('button', { name: 'Assigning…', exact: true })).toBeDisabled();
    await expect(page.getByText('TASK COMPLETE: synthetic terminal text')).toHaveCount(0);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.mode = 'started'; });
    await expect(page.getByRole('status').filter({ hasText: 'Runner verified start' })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
  });
  test('work Single Entry reports verified start while completion stays unknown', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.fault = 'completion-unknown'; });
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('start known');
    await assign(page);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Outcome unknown');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event: 3');
    await home(page);
    await expect(page.getByRole('status').filter({ hasText: 'Runner verified start' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
    const state = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.work);
    expect(state.terminal).toBe(false); expect(state.outcome).toBe('unknown');
  });
  test('work Single Entry session exit after dispatch retains uncertainty and never replays', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.holdSubmit = true; });
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('uncertain once'); await assign(page);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.length)).toBe(1);
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await home(page);
    await expect(page.getByRole('alert').filter({ hasText: 'automatic retry and reassignment are blocked' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('uncertain once');
    await expect(page.getByRole('button', { name: 'Assign instruction' })).toBeDisabled();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.length)).toBe(1);
  });
  for (const language of ['en', 'ko']) {
    test('work Single Entry keeps pending terminal interaction user-owned in ' + language, async ({ page }) => {
      await ready(page);
      await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.holdOperation = 'session_config.apply'; });
      await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('unsent during terminal interaction'); await assign(page);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.features.results
        .some(r => r.operation === 'session_config.apply' && r.state === 'queued'))).toBe(true);
      await page.evaluate(() => { const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
        Object.assign(fixture.features.results.find(r => r.operation === 'session_config.apply'), { state: 'pending-interaction', phase: 'awaiting_interaction' }); });
      await page.waitForFunction(() => JSON.parse(window.__nativeFixture.observed.get('pty-1')).features.results
        .some(r => r.operation === 'session_config.apply' && r.state === 'pending-interaction'));
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.locator('.xterm-helper-textarea').press('Escape');
      expect(await page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
      await page.evaluate(() => { const fixture = window.__nativeFixture.sessions.get('pty-1').feature; fixture.config.holdOperation = ''; fixture.config.complete(); });
      await home(page);
      await expect(page.getByRole('button', { name: language === 'en' ? 'Release unsent assignment' : '미전송 배정 해제' })).toBeVisible();
      await expect(page.locator('.composer textarea')).toHaveValue('unsent during terminal interaction');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
    });
    test('work Single Entry catalogs configure exact account model Direct Root in ' + language, async ({ page }, info) => {
      await ready(page);
      await page.getByRole('button', { name: 'Load authenticated Runner options' }).click();
      await expect(page.getByRole('combobox', { name: 'Single Entry Account', exact: true })).toBeEnabled();
      await page.getByRole('combobox', { name: 'Single Entry Account', exact: true }).selectOption(JSON.stringify({ agent_id: 'other', profile_name: 'first' }));
      await expect(page.getByRole('combobox', { name: 'Single Entry Model', exact: true })).toBeEnabled();
      await page.getByRole('combobox', { name: 'Single Entry Model', exact: true }).selectOption({ label: 'm2' });
      await page.getByRole('combobox', { name: 'Single Entry Reasoning effort', exact: true }).selectOption('high');
      await page.getByRole('combobox', { name: 'Single Entry Service tier', exact: true }).selectOption('fast');
      await page.getByRole('combobox', { name: 'Single Entry Project / Target', exact: true }).selectOption(JSON.stringify({ binding_state: 'bound', owner: 'Project', project: 'Exact' }));
      await page.getByRole('combobox', { name: 'Single Entry Run Mode', exact: true }).selectOption(JSON.stringify('direct-run'));
      await page.getByRole('textbox', { name: 'Single Entry Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
      await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('configured once');
      await assign(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
      const result = await page.evaluate(() => ({ current: window.__nativeFixture.sessions.get('pty-1').feature.config.current,
        requests: window.__nativeFixture.sessions.get('pty-1').feature.config.requests,
        safe: JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry }));
      expect(result.current).toEqual({ target: 'project:Exact', account: { agent_id: 'other', profile_name: 'first' },
        model: { id: 'm2', reasoning_effort: 'high' }, service_tier: 'fast', run_mode: 'direct-run', root: 'C:/explicit-root' });
      expect(result.safe.accountIdentity).toEqual(result.current.account); expect(result.safe).not.toHaveProperty('account');
      const apply = result.requests.find(r => r.operation === 'session_config.apply');
      expect(apply.desired.account).toEqual(result.current.account);
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
      await home(page);
      await expect(page.locator('.control-status')).toContainText(language === 'en' ? 'Runner verified start' : 'Runner 시작 확인');
      await info.attach('single-entry-work-' + language, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
  for (const mode of ['pure-direct-run', 'direct-run', 'task-run', 'issue-run']) {
    test('work Single Entry applies Base Run Mode ' + mode, async ({ page }) => {
      await ready(page);
      await page.evaluate(mode => localStorage.setItem('agent-runner-hub.preferences.v1', JSON.stringify({ version: 1, language: 'en', theme: 'light',
        singleEntry: { runMode: mode, ...(['pure-direct-run', 'direct-run'].includes(mode) ? { root: 'C:/explicit-root' } : {}) } })), mode);
      await page.reload();
      await expect(page.getByRole('status').filter({ hasText: 'Spare Runner ready.' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('mode once'); await assign(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.current.run_mode)).toBe(mode);
    });
  }
  for (const fault of ['confirmation', 'partial', 'legacy-account', 'inventory']) {
    test('work Single Entry holds its draft and exact session on ' + fault, async ({ page }) => {
      await ready(page);
      await page.evaluate(fault => {
        const s = window.__nativeFixture.sessions.get('pty-1');
        if (fault === 'confirmation') s.feature.config.planStatus = 'confirmation_required';
        if (fault === 'partial') s.feature.config.applyOutcome = 'partial';
        if (fault === 'inventory') s.items.push({ reference_id: 'a'.repeat(32), display_index: 1, display_name: 'pending', kind: 'file' });
      }, fault);
      if (fault === 'partial') {
        await page.getByRole('button', { name: 'Load authenticated Runner options' }).click();
        await page.getByRole('combobox', { name: 'Single Entry Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
        await page.getByRole('combobox', { name: 'Single Entry Project / Target', exact: true }).selectOption(JSON.stringify({ binding_state: 'bound', owner: 'Project', project: 'Exact' }));
      }
      if (fault === 'legacy-account') {
        await page.evaluate(() => localStorage.setItem('agent-runner-hub.preferences.v1', JSON.stringify({ version: 1, language: 'en', theme: 'light', singleEntry: { account: 'first' } })));
        await page.reload(); await expect(page.getByRole('status').filter({ hasText: 'Spare Runner ready.' })).toBeVisible();
      }
      await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('retain this draft'); await assign(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runner 1');
      await home(page); await expect(page.getByRole('button', { name: 'Release unsent assignment' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('retain this draft');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
    });
  }
  for (const mode of ['rejected', 'unknown']) {
    test('work Single Entry retains ' + mode + ' without replay', async ({ page }) => {
      await ready(page, { workMode: mode });
      await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('once'); await assign(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText(mode === 'rejected' ? 'Rejected' : 'Outcome unknown');
      await home(page);
      await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('once');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
      if (mode === 'unknown') await expect(page.getByRole('button', { name: 'Assign instruction' })).toBeDisabled();
    });
  }
}
