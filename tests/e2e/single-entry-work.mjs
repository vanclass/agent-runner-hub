import { registerInstructionPresentation } from './instruction-presentation.mjs';

export function registerSingleEntryWork({ test, expect, transport, configure, create }) {
  test('work Single Entry stale cleanup cannot release a newer reservation or attachment freeze', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { SingleEntry } = await import('/src/hub/singleEntry.ts');
      let finish, successor, releases = 0, creates = 0;
      const pending = new Promise(resolve => { finish = resolve; });
      let entry;
      const session = index => ({ view: { id: `owned-${index}`, name: 'Owned', status: 'failed' },
        control: { assignmentLocked: true }, release() {
          releases++;
          this.control.assignmentLocked = false;
          if (index === 1) { entry.setDraft('new draft'); successor = entry.submit('/owned'); }
        } });
      const sessions = [];
      entry = new SingleEntry(() => [], () => {
        const owned = session(++creates); sessions.push(owned);
        return { session: owned, launched: creates === 1 ? Promise.resolve() : pending };
      }, () => entry.observe());
      entry.setDraft('original');
      entry.attachments.candidates.push({ key: 1, path: '/owned/file', phase: 'staged' });
      await entry.submit('/owned');
      const evidence = { creates, releases, draft: entry.draft, locked: entry.attachments.locked,
        paths: entry.attachments.paths, reserved: sessions[1].control.assignmentLocked };
      finish(); await successor;
      return evidence;
    });
    expect(result).toEqual({ creates: 2, releases: 1, draft: 'new draft', locked: true,
      paths: ['/owned/file'], reserved: true });
  });
  registerInstructionPresentation({ test, expect, transport, configure, create });
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  const assign = page => page.locator('textarea[data-instruction]').press('Enter');
  async function ready(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options });
    await configure(page);
    await expect(page.locator('.spare-status')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
  }
  test('work Single Entry defaults to a promoted spare focuses immediately and submits exactly once', async ({ page }, info) => {
    await ready(page);
    await expect(page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' })).toHaveCount(0);
    await page.locator('textarea[data-instruction]').fill('one instruction\n안녕 🌍');
    await page.locator('textarea[data-instruction]').focus();
    await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    await expect(page.locator('.runner-row .nav-row[aria-current="page"]')).toContainText('Runner 1');
    await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event: 3', { timeout: 35000 });
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
    await home(page);
    await expect(page.locator('textarea[data-instruction]')).toHaveValue('');
    await expect(page.locator('.hub-log-records').filter({ hasText: 'work.started' })).toBeVisible();
    await expect(page.getByText('Assignment evidence', { exact: true })).toHaveCount(0);
    await expect(page.locator('.xterm')).toHaveCount(0);
    const receipt = await page.evaluate(() => ({ requests: window.__nativeFixture.sessions.get('pty-1').feature.requests,
      original: window.__nativeFixture.sessions.get('pty-1').feature.work.submission_request_id,
      count: window.__nativeFixture.count(), writes: window.__nativeFixture.writes,
      tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs }));
    expect(receipt.requests.filter(r => r.operation === 'work.submit')).toHaveLength(1);
    expect(receipt.requests.find(r => r.operation === 'work.submit').instruction).toBe('one instruction\n안녕 🌍');
    expect(receipt.requests.filter(r => r.operation === 'work.observe').every(r => r.observation_id === `api:${receipt.original}`)).toBeTruthy();
    expect(receipt.writes).toEqual([]);
    expect(receipt.count).toBe(2); expect(receipt.tabs).toHaveLength(1);
    await info.attach('single-entry-work-start-summary', { body: await page.screenshot(), contentType: 'image/png' });
  });
  test('work Single Entry explicit reuse preserves the selected visible process while always-new ignores it', async ({ page }) => {
    await ready(page); await create(page);
    await expect(page.getByRole('combobox', { name: 'Requested Account', exact: true })).toBeEnabled();
    await home(page);

    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Runner allocation policy' }).selectOption('reuse-idle');
    await page.keyboard.press('Escape');
    await page.locator('textarea[data-instruction]').fill('reuse once');
    await assign(page);
    await expect(page.locator('.runner-row .nav-row[aria-current="page"]')).toContainText('Runner 1');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
    await home(page);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Runner allocation policy' }).selectOption('always-new');
    await page.keyboard.press('Escape');
    await page.locator('textarea[data-instruction]').fill('always new');
    await assign(page);
    await expect(page.locator('.runner-row .nav-row[aria-current="page"]')).toContainText('Runner 2');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
    const newSubmission = await page.evaluate(() => [...window.__nativeFixture.sessions]
      .filter(([, s]) => s.feature.requests.some(r => r.operation === 'work.submit' && r.instruction === 'always new'))
      .map(([id, s]) => ({ id, count: s.feature.requests.filter(r => r.operation === 'work.submit').length })));
    expect(newSubmission).toHaveLength(1); expect(newSubmission[0].id).not.toBe('pty-1'); expect(newSubmission[0].count).toBe(1);
    await expect(page.locator('.xterm-rows')).toContainText(newSubmission[0].id);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry.allocationPolicy)).toBe('always-new');
  });
  test('work Single Entry falls back to supported fresh launch when no spare is ready', async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true }); await page.goto('/');
    const result = await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const owner = new RunnerSessions({ accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run' });
      owner.entry.setDraft('fresh launch once');
      await owner.entry.submit('/fixture/install');
      if (owner.entry.phase !== 'delivered') throw new Error(JSON.stringify(owner.entry.detail));
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
        () => {}, { allocationPolicy: 'reuse-idle', accountIdentity: { agent_id: 'codex', profile_name: 'first' } }));
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
    await page.locator('textarea[data-instruction]').fill('one waiting instruction'); await assign(page);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Admitted · start unconfirmed', { timeout: 35000 });
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', 'TASK COMPLETE: synthetic terminal text\r\n'));
    await home(page);
    await expect(page.locator('textarea[data-instruction]')).toHaveValue('one waiting instruction');
    await expect(page.locator('textarea[data-instruction]')).toBeDisabled();
    await expect(page.getByText('TASK COMPLETE: synthetic terminal text')).toHaveCount(0);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.mode = 'started'; });
    await expect(page.locator('.hub-log-records').filter({ hasText: 'work.started' })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
  });
  test('work Single Entry reports verified start while completion stays unknown', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.fault = 'completion-unknown'; });
    await page.locator('textarea[data-instruction]').fill('start known');
    await assign(page);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Outcome unknown', { timeout: 35000 });
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event: 3');
    await home(page);
    await expect(page.locator('.hub-log-records').filter({ hasText: 'work.started' })).toBeVisible();
    await expect(page.locator('textarea[data-instruction]')).toHaveValue('');
    const state = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.work);
    expect(state.terminal).toBe(false); expect(state.outcome).toBe('unknown');
  });
  test('work Single Entry session exit after dispatch retains uncertainty and never replays', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.holdSubmit = true; });
    await page.locator('textarea[data-instruction]').fill('uncertain once'); await assign(page);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length), { timeout: 35000 }).toBe(1);
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(page.locator('.runner-instruction pre')).toHaveText('uncertain once');
    await expect(page.locator('.runner-instruction')).toContainText('Outcome unknown');
    await home(page);
    await expect(page.locator('.hub-log-records').filter({ hasText: 'actual=unknown' })).toBeVisible();
    await expect(page.locator('textarea[data-instruction]')).toHaveValue('uncertain once');
    await expect(page.locator('textarea[data-instruction]')).toBeDisabled();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
  });
  for (const language of ['en', 'ko']) {
    test('work Single Entry keeps pending configuration interaction gated in ' + language, async ({ page }) => {
      await ready(page);
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
      await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.holdOperation = 'session_config.apply'; });
      await page.locator('textarea[data-instruction]').fill('unsent during terminal interaction'); await assign(page);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.features.results
        .some(r => r.operation === 'session_config.apply' && r.state === 'queued'))).toBe(true);
      await page.evaluate(() => { const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
        Object.assign(fixture.features.results.find(r => r.operation === 'session_config.apply'), { state: 'pending-interaction', phase: 'awaiting_interaction' }); });
      await page.waitForFunction(() => JSON.parse(window.__nativeFixture.observed.get('pty-1')).features.results
        .some(r => r.operation === 'session_config.apply' && r.state === 'pending-interaction'));
      await page.locator('.app-settings-trigger').click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.keyboard.press('Escape');
      await page.locator('.xterm-helper-textarea').press('Escape');
      expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation !== 'work.list'))).toEqual([]);
      await page.evaluate(() => { const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
        fixture.config.holdOperation = ''; fixture.config.applyOutcome = 'cancelled'; fixture.config.complete(); });
      await home(page);
      await expect(page.getByRole('button', { name: language === 'en' ? 'Release unsent assignment' : '미전송 배정 해제' })).toHaveCount(0);
      await expect(page.locator('.composer textarea')).toHaveValue('unsent during terminal interaction');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation !== 'work.list'))).toEqual([]);
    });
    test('work Single Entry catalogs configure exact account model Direct Root in ' + language, async ({ page }, info) => {
      await ready(page);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();

      await expect(page.getByRole('combobox', { name: 'Requested Account', exact: true })).toBeEnabled();
      await page.getByRole('combobox', { name: 'Requested Account', exact: true }).selectOption(JSON.stringify({ agent_id: 'other', profile_name: 'first' }));
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })).toBeEnabled();
      await page.getByRole('combobox', { name: 'Requested Model', exact: true }).selectOption({ label: 'm2' });
      await page.getByRole('combobox', { name: 'Requested Reasoning effort', exact: true }).selectOption('high');
      await page.getByRole('checkbox', { name: 'Fast', exact: true }).check();
      await page.getByRole('combobox', { name: 'Requested Project / Target', exact: true }).selectOption(JSON.stringify({ binding_state: 'bound', owner: 'Project', project: 'Exact' }));
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('direct-run'));
      await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
      await page.locator('textarea[data-instruction]').fill('configured once');
      await assign(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
      const result = await page.evaluate(() => ({ current: window.__nativeFixture.sessions.get('pty-1').feature.config.current,
        requests: window.__nativeFixture.sessions.get('pty-1').feature.config.requests,
        safe: JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry }));
      expect(result.current).toEqual({ target: 'project:Exact', account: { agent_id: 'other', profile_name: 'first' },
        model: { id: 'm2', reasoning_effort: 'high' }, service_tier: 'fast', run_mode: 'direct-run', root: 'C:/explicit-root' });
      expect(result.safe.accountIdentity).toEqual(result.current.account); expect(result.safe).not.toHaveProperty('account');
      const apply = result.requests.find(r => r.operation === 'session_config.apply');
      expect(apply.desired.account).toEqual(result.current.account);
      await page.locator('.app-settings-trigger').click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.keyboard.press('Escape');
      await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
      await home(page);
      await expect(page.locator('.hub-log-records')).toContainText('work.started');
      await info.attach('single-entry-work-' + language, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
  for (const mode of ['pure-direct-run', 'direct-run', 'task-run', 'issue-run']) {
    test('work Single Entry applies Base Run Mode ' + mode, async ({ page }) => {
      await ready(page);
      await page.evaluate(mode => localStorage.setItem('agent-runner-hub.preferences.v1', JSON.stringify({ version: 1, language: 'en', theme: 'light',
        singleEntry: { accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: mode,
          ...(['pure-direct-run', 'direct-run'].includes(mode) ? { root: 'C:/explicit-root' } : {}) } })), mode);
      await page.reload();
      await expect(page.locator('.spare-status')).toHaveCount(0);
      await page.locator('textarea[data-instruction]').fill('mode once'); await assign(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
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
        await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
        await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
        await page.getByRole('combobox', { name: 'Requested Project / Target', exact: true }).selectOption(JSON.stringify({ binding_state: 'bound', owner: 'Project', project: 'Exact' }));
      }
      if (fault === 'legacy-account') {
        await page.evaluate(() => localStorage.setItem('agent-runner-hub.preferences.v1', JSON.stringify({ version: 1, language: 'en', theme: 'light', singleEntry: { account: 'first' } })));
        await page.reload(); await expect(page.locator('.spare-status')).toHaveCount(0);
      }
      await page.locator('textarea[data-instruction]').fill('retain this draft'); await assign(page);
      await expect(page.locator('.runner-row .nav-row[aria-current="page"]')).toContainText('Runner 1');
      await home(page); await expect(page.getByRole('button', { name: 'Release unsent assignment' })).toHaveCount(0);
      await expect(page.locator('textarea[data-instruction]')).toHaveValue('retain this draft');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation !== 'work.list'))).toEqual([]);
      expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
    });
  }
  for (const mode of ['rejected', 'unknown']) {
    test('work Single Entry retains ' + mode + ' without replay', async ({ page }) => {
      await ready(page, { workMode: mode });
      await page.locator('textarea[data-instruction]').fill('once'); await assign(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText(mode === 'rejected' ? 'Rejected' : 'Outcome unknown', { timeout: 35000 });
      await home(page);
      await expect(page.locator('textarea[data-instruction]')).toHaveValue('once');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
      if (mode === 'unknown') await expect(page.locator('textarea[data-instruction]')).toBeDisabled();
    });
  }
  test('work Single Entry confirmed-unsent rejection restores the Runner input without release UI', async ({ page }) => {
    await ready(page, { workMode: 'rejected' });
    const input = page.locator('textarea[data-instruction]');
    await input.fill('retained original'); await input.press('Enter');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Rejected', { timeout: 35000 });
    await expect(input).toBeEnabled(); await input.click();
    await expect(input).toBeFocused(); await input.fill('independent tab draft');
    await home(page);
    await expect(input).toHaveValue('retained original'); await expect(input).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Release unsent assignment' })).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
      .filter(r => r.operation === 'work.submit').length)).toBe(1);
    await page.keyboard.press('Control+End');
    await expect(input).toHaveValue('independent tab draft');
  });
}
