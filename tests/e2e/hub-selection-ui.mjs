export function registerHubSelectionUI({ test, expect, transport, configure, create }) {
  const key = 'agent-runner-hub.preferences.v1';
  const requested = (page, field) => page.getByRole('combobox', { name: `Requested ${field}`, exact: true });
  test('Hub selections initialize automatically then restore independent tab choices without startup inspection', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await expect(requested(page, 'Model').getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    const initial = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).singleEntry, key);
    expect(initial).toEqual({ initialized: true, target: { binding_state: 'bound', owner: 'Workspace', project: '' },
      accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'pure-direct-run',
      model: { model: 'm0', reasoning_effort: 'medium', service_tier: 'default' } });
    expect(await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).inputValue()).toBe('');
    await expect(page.getByRole('button', { name: 'Refresh available choices' })).toHaveCount(0);
    await create(page);
    await requested(page, 'Run Mode').focus();
    await requested(page, 'Run Mode').selectOption({ label: 'issue-run' });
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await requested(page, 'Model').selectOption({ label: 'm2' });
    await create(page);
    await expect(requested(page, 'Model')).toHaveValue(/m2/);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    await expect(requested(page, 'Run Mode')).toHaveValue(/issue-run/);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    expect(Object.values(saved.runnerSelections).map(v => v.model.model)).toEqual(['m0', 'm2']);
    const noEffects = await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
      !s.feature.requests.some(r => r.operation === 'work.submit')
      && s.feature.config.requests.every(r => r.operation === 'session_config.inspect')));
    expect(noEffects).toBe(true);
    await page.reload();
    await expect(requested(page, 'Model')).toHaveValue(/m2/);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.config.requests))).toEqual([]);
    // A changed authenticated catalog is loaded only on interaction; the saved value stays visible.
    await page.evaluate(() => {
      for (const s of window.__nativeFixture.sessions.values()) {
        const original = s.feature.config.inspection.bind(s.feature.config);
        s.feature.config.inspection = (...args) => {
          const result = original(...args); result.options.models.forEach(m => { m.id = `new-${m.id}`; }); return result;
        };
      }
    });
    await requested(page, 'Model').focus();
    await expect(requested(page, 'Model').getByRole('option', { name: 'new-m0', exact: true })).toBeAttached();
    await expect(requested(page, 'Model')).toHaveValue(/m2/);
    await expect(requested(page, 'Model').locator('option:checked')).toContainText('Not in verified options');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(saved);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(requested(page, 'Model')).toHaveValue(/m0/);
    await expect(requested(page, 'Run Mode')).toHaveValue(/issue-run/);
    await info.attach('restored-independent-Hub-selections', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
