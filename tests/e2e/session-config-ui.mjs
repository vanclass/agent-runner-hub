export function registerSessionConfigUI({ test, expect, transport, configure }) {
  const field = (page, name) => page.getByRole('combobox', { name: 'Requested ' + name, exact: true });
  const composer = page => page.getByRole('textbox', { name: 'Runner instructions', exact: true });
  const send = page => page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  async function open(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options }); await configure(page);
    await expect(field(page, 'Model').getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await expect(field(page, 'Run Mode')).toBeEnabled();
    await field(page, 'Run Mode').focus();
    await expect(field(page, 'Run Mode').getByRole('option', { name: 'task-run', exact: true })).toBeAttached();
    await field(page, 'Run Mode').selectOption({ label: 'task-run' });
  }
  test('session submission applies exact tab selections once before work, with no exposed commands', async ({ page }, info) => {
    await open(page);
    await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await field(page, 'Account').selectOption(JSON.stringify({ agent_id: 'other', profile_name: 'first' }));
    await expect(field(page, 'Model').getByRole('option', { name: 'm2', exact: true })).toBeAttached();
    await field(page, 'Model').selectOption({ label: 'm2' });
    await field(page, 'Reasoning effort').selectOption('high');
    await page.getByRole('checkbox', { name: 'Fast', exact: true }).check();
    await field(page, 'Project / Target').selectOption({ label: 'project:Exact' });
    await field(page, 'Run Mode').selectOption({ label: 'direct-run' });
    await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
    await expect(page.locator('.task-panel .runner-controls, .task-panel .runner-config, .task-panel .command-button')).toHaveCount(0);
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
      s.feature.config.requests.every(r => r.operation === 'session_config.inspect') && !s.feature.requests.length))).toBe(true);
    await page.evaluate(() => {
      const f = window.__nativeFixture.sessions.get('pty-1').feature;
      f.config.holdOperation = 'session_config.apply';
    });
    await composer(page).fill('exact once\n안녕 🌍'); await send(page);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests
      .some(r => r.operation === 'session_config.apply'))).toBe(true);
    await page.locator('.runner-row').nth(1).locator('.nav-row').click();
    await composer(page).fill('independent draft');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-2').feature.requests)).toEqual([]);
    await page.evaluate(() => {
      const f = window.__nativeFixture.sessions.get('pty-1').feature;
      f.config.holdOperation = ''; f.config.complete();
    });
    await expect(composer(page)).toHaveValue('independent draft');
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(composer(page)).toHaveValue('', { timeout: 30000 });
    const result = await page.evaluate(() => {
      const n = window.__nativeFixture, f = n.sessions.get('pty-1').feature;
      return { current: f.config.current, work: f.requests, other: n.sessions.get('pty-2').feature.requests,
        effects: f.features.results.filter(r => ['session_config.apply', 'work.submit'].includes(r.operation)).map(r => r.operation), writes: n.writes };
    });
    expect(result.current).toEqual({ target: 'project:Exact', account: { agent_id: 'other', profile_name: 'first' },
      model: { id: 'm2', reasoning_effort: 'high' }, service_tier: 'fast', run_mode: 'direct-run', root: 'C:/explicit-root' });
    expect(result.work.filter(r => r.operation === 'work.submit')).toEqual([{ operation: 'work.submit', api_version: 1, instruction: 'exact once\n안녕 🌍' }]);
    expect(result.effects).toEqual(['session_config.apply', 'work.submit']); expect(result.other).toEqual([]); expect(result.writes).toEqual([]);
    await info.attach('tab-submission', { body: await page.screenshot(), contentType: 'image/png' });
  });
  test('session submission verifies a no-op without Apply and rejects duplicate clicks', async ({ page }) => {
    await open(page); await composer(page).fill('once');
    await page.getByRole('button', { name: 'Send instruction', exact: true }).evaluate(b => { b.click(); b.click(); });
    await expect(composer(page)).toHaveValue('', { timeout: 30000 });
    const result = await page.evaluate(() => {
      const f = window.__nativeFixture.sessions.get('pty-1').feature;
      return { applies: f.config.requests.filter(r => r.operation.endsWith('.apply')), submits: f.requests.filter(r => r.operation === 'work.submit') };
    });
    expect(result.applies).toEqual([]); expect(result.submits).toHaveLength(1);
  });
  for (const fault of ['invalid', 'confirmation_required', 'partial', 'final-inspection', 'unknown-config', 'root', 'unsupported']) {
    test('session submission preserves unsent draft on ' + fault, async ({ page }) => {
      await open(page);
      await field(page, 'Run Mode').selectOption({ label: fault === 'root' ? 'direct-run' : 'issue-run' });
      if (['partial', 'final-inspection'].includes(fault))
        await field(page, 'Project / Target').selectOption({ label: 'project:Exact' });
      await page.evaluate(fault => {
        const f = window.__nativeFixture.sessions.get('pty-1').feature.config;
        if (['invalid', 'confirmation_required'].includes(fault)) f.planStatus = fault;
        if (fault === 'partial') f.applyOutcome = 'partial';
        if (fault === 'final-inspection') { f.applyOutcome = 'partial'; f.postApplyFailure = true; }
        if (fault === 'unknown-config') f.applyOutcome = 'unknown';
        if (fault === 'unsupported') {
          const inspect = f.inspection.bind(f);
          f.inspection = (...args) => { const v = inspect(...args); v.options.models = []; v.options_page.totals.models = 0; return v; };
        }
      }, fault);
      await composer(page).fill('keep me'); await send(page);
      await expect(page.locator('.composer-area [role=alert]')).toBeVisible();
      await expect(composer(page)).toHaveValue('keep me');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
      if (['partial', 'final-inspection'].includes(fault)) {
        await expect(page.locator('.config-receipt')).toContainText('Some settings committed');
        await expect(page.locator('.config-receipt')).toContainText('Owner-confirmed commit');
      }
      if (['invalid', 'confirmation_required', 'root', 'unsupported'].includes(fault))
        expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests.filter(r => r.operation.endsWith('.apply')))).toEqual([]);
      await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
    });
  }
  for (const mode of ['rejected', 'unknown']) {
    test('session submission retains ' + mode + ' without replay and reconciles late start', async ({ page }) => {
      await open(page, { workMode: mode });
      await composer(page).fill('retained once'); await send(page);
      await expect(page.getByLabel('Runner work', { exact: true })).toContainText(mode === 'rejected' ? 'Rejected' : 'Outcome unknown', { timeout: 30000 });
      await expect(composer(page)).toHaveValue('retained once');
      if (mode === 'unknown') {
        await expect(composer(page)).toBeDisabled();
        await page.evaluate(() => { const f = window.__nativeFixture.sessions.get('pty-1').feature; f.mode = 'started'; });
        await page.getByRole('button', { name: 'Refresh work status', exact: true }).click();
        await expect(composer(page)).toHaveValue('');
      }
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit'))).toHaveLength(1);
    });
  }
  test('session submission fences late configuration after owning process exit', async ({ page }) => {
    await open(page);
    await field(page, 'Run Mode').selectOption({ label: 'issue-run' });
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.holdOperation = 'session_config.apply'; });
    await composer(page).fill('never replay'); await send(page);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests
      .some(r => r.operation === 'session_config.apply'))).toBe(true);
    await page.evaluate(() => { const n = window.__nativeFixture; n.exit('pty-1', 0, n.sessions.get('pty-1').control); });
    await expect(page.getByText('Process exited (0)', { exact: true })).toBeVisible();
    await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.complete());
    await expect(composer(page)).toHaveValue('never replay');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
  });
  test('session foreground replies use PTY without configuration, work or reference admission', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.attention.foreground_interaction_active = true; });
    await page.waitForFunction(() => JSON.parse(window.__nativeFixture.observed.get('pty-1')).observation.attention.foreground_interaction_active);
    const before = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests.length);
    await composer(page).fill('foreground answer'); await send(page);
    await expect(composer(page)).toHaveValue('');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.requests.length)).toBe(before);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.writes.length)).toBe(1);
    await page.locator('.xterm-helper-textarea').press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(1);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.attention.foreground_interaction_active = false; });
    await page.waitForFunction(() => !JSON.parse(window.__nativeFixture.observed.get('pty-1')).observation.attention.foreground_interaction_active);
    await page.waitForTimeout(600);
    const writes = await page.evaluate(() => window.__nativeFixture.writes.length);
    await page.locator('.xterm-helper-textarea').press('a');
    expect(await page.evaluate(() => window.__nativeFixture.writes.length)).toBe(writes);
    await page.locator('.xterm-helper-textarea').press('Tab');
    await expect(page.locator('.xterm-helper-textarea')).not.toBeFocused();
  });
  for (const fault of ['inventory-change', 'other-pending', 'unknown-registration']) {
    test('session reference safeguards retain draft on ' + fault, async ({ page }) => {
      await open(page);
      await page.evaluate(fault => {
        const s = window.__nativeFixture.sessions.get('pty-1');
        if (fault === 'inventory-change') s.changeInventoryAt = 2;
        if (fault === 'other-pending') s.items.push({ reference_id: 'a'.repeat(32), display_name: 'other', kind: 'file' });
        if (fault === 'unknown-registration') s.control.references.results.push({ id: 999,
          operation: 'references.register', state: 'outcome-unknown' });
      }, fault);
      await composer(page).fill('references unsent'); await send(page);
      await expect(page.locator('.composer-area > [role=alert]')).toBeVisible({ timeout: 30000 });
      await expect(composer(page)).toHaveValue('references unsent');
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
    });
  }
  test('session reference preflight still verifies selected inventory before API work', async ({ page }) => {
    await open(page, { clipboard: true });
    await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await expect(page.locator('.attachment-chip')).toContainText('Staged · unregistered');
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.request.operation === 'references.register'))).toEqual([]);
    await composer(page).fill('with reference'); await send(page);
    await expect(composer(page)).toHaveValue('', { timeout: 30000 });
    const registration = await page.evaluate(() => {
      const s = window.__nativeFixture.sessions.get('pty-1');
      return { receipts: s.control.references.results.filter(r => r.state === 'registered'), inventory: s.items };
    });
    expect(registration.receipts).toHaveLength(1); expect(registration.inventory).toHaveLength(1);
    expect(registration.receipts[0].registrationStatus).toBe('registered');
    expect(registration.inventory[0].reference_id).toBe(registration.receipts[0].reference.reference_id);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit'))).toHaveLength(1);
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.request.operation === 'references.list').length)).toBeGreaterThan(1);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
