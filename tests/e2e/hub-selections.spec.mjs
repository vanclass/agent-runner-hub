import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

const key = 'agent-runner-hub.preferences.v1';
test('a removed saved account stays visible while interaction can choose a verified replacement', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { service, fixture } = createConfigHarness(), commits = [];
    const saved = { accountIdentity: { agent_id: 'removed', profile_name: 'retained' },
      model: { model: 'retained-model', reasoning_effort: 'high', service_tier: 'fast' } };
    const selections = new HubSelections(() => service, () => {}, saved, value => commits.push(value));
    await selections.inspectOptions();
    return { defaults: selections.defaults, accounts: selections.catalog?.options.accounts, commits, detail: selections.detail };
  });
  expect(result.defaults.accountIdentity).toEqual({ agent_id: 'removed', profile_name: 'retained' });
  expect(result.accounts).toContainEqual({ agent_id: 'codex', profile_name: 'second' });
  expect(result.commits).toEqual([]); expect(result.detail).toBeTruthy();
});

test('Hub preference projection rejects sensitive per-tab runtime fields', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => import('/src/hub/preferences.ts').then(({ HubPreferences }) => {
    const store = new HubPreferences(), id = '12345678-1234-1234-1234-123456789abc';
    store.saveRunner(id, { model: { model: 'saved', reasoning_effort: 'high', service_tier: 'fast' } });
    const before = localStorage.getItem('agent-runner-hub.preferences.v1');
    for (const field of ['credentials', 'session', 'generation', 'options_revision', 'instruction', 'token'])
      store.saveRunner(id, { [field]: 'private runtime data' });
    return { before, after: localStorage.getItem('agent-runner-hub.preferences.v1') };
  }));
  expect(result.after).toBe(result.before); expect(result.after).not.toContain('private runtime data');
});

test('Hub automatically commits ordered destination-account choices once and restores without inspecting', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { HubPreferences } = await import('/src/hub/preferences.ts');
    const { service, fixture } = createConfigHarness();
    const inspect = fixture.inspection.bind(fixture);
    fixture.inspection = (account, offset = 0) => {
      const result = inspect(account, offset);
      result.options.accounts = [fixture.accounts[1], fixture.accounts[2], fixture.accounts[0]].slice(offset, offset + 2);
      result.options.models.forEach(m => { m.reasoning_efforts = ['high', 'medium']; m.service_tiers = ['fast', 'default']; });
      return result;
    };
    const preferences = new HubPreferences(), commits = [];
    const selections = new HubSelections(() => service, () => {}, {}, value => {
      commits.push(value); preferences.update({ singleEntry: value });
    });
    window.__selection = { selections, fixture, preferences, commits, HubSelections, HubPreferences };
    selections.initialize();
  });
  await expect.poll(() => page.evaluate(() => window.__selection.commits.length)).toBe(1);
  const result = await page.evaluate(() => {
    const { selections, fixture, commits, HubSelections, HubPreferences } = window.__selection;
    const restored = new HubSelections(() => { throw Error('restart must not inspect'); }, () => {}, new HubPreferences().value.singleEntry);
    restored.initialize();
    return { defaults: selections.defaults, restored: restored.defaults, commits, requests: fixture.requests };
  });
  const expected = { initialized: true, target: { binding_state: 'bound', owner: 'Workspace', project: '' },
    accountIdentity: { agent_id: 'codex', profile_name: 'second' }, runMode: 'pure-direct-run',
    model: { model: 's0', reasoning_effort: 'high', service_tier: 'fast' } };
  expect(result.defaults).toEqual(expected); expect(result.restored).toEqual(expected); expect(result.commits).toEqual([expected]);
  expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
  expect(result.requests.filter(r => r.account).map(r => r.account)).toEqual(Array(3).fill(expected.accountIdentity));
  expect(result.defaults).not.toHaveProperty('root');
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key), key)).singleEntry).toEqual(expected);
});

test('Hub preserves partial and unsupported saved values across initialization and later catalog refresh', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { service, fixture } = createConfigHarness(), commits = [];
    const saved = { target: { binding_state: 'bound', owner: 'Project', project: 'exact/SAVED' },
      model: { model: 'removed', reasoning_effort: 'unsupported', service_tier: 'retained' } };
    const selections = new HubSelections(() => service, () => {}, saved, v => commits.push(v));
    selections.initialize(); const startupRequests = fixture.requests.length;
    await selections.inspectOptions();
    return { saved, defaults: selections.defaults, startupRequests, commits };
  });
  expect(result.defaults).toEqual(result.saved); expect(result.startupRequests).toBe(0); expect(result.commits).toEqual([]);
});

for (const fault of ['token', 'unavailable', 'missing']) {
  test(`Hub retains empty preferences after ${fault} inspection and permits an explicit retry`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async fault => {
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const { service, fixture } = createConfigHarness(), commits = [];
      fixture.fault = fault;
      const selections = new HubSelections(() => service, () => {}, {}, v => commits.push(v));
      await selections.inspectOptions(); const failed = { defaults: selections.defaults, detail: selections.detail, commits: commits.length };
      fixture.fault = ''; await selections.inspectOptions();
      return { failed, defaults: selections.defaults, commits, requests: fixture.requests };
    }, fault);
    expect(result.failed.defaults).toEqual({}); expect(result.failed.commits).toBe(0); expect(result.failed.detail).toBeTruthy();
    expect(result.commits).toHaveLength(1); expect(result.defaults.model.model).toBe('m0');
    expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
  });
}

test('Hub discards delayed initialization after a newer local edit', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { service, fixture } = createConfigHarness(), commits = [];
    fixture.hold = true;
    const selections = new HubSelections(() => service, () => {}, {}, v => commits.push(v));
    const pending = selections.inspectOptions();
    selections.setDefault('allocationPolicy', 'reuse-idle');
    fixture.hold = false; fixture.complete(); await pending;
    return { defaults: selections.defaults, commits, requests: fixture.requests };
  });
  expect(result.defaults).toEqual({ allocationPolicy: 'reuse-idle', initialized: true });
  expect(result.commits).toEqual([result.defaults]);
  expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
});

test('Hub rejects incomplete availability and requires explicit Direct Root', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { entryDefaultsToDesired } = await import('/src/hub/runnerConfigDefaults.ts');
    const { service, fixture } = createConfigHarness(), commits = [];
    const inspection = fixture.inspection.bind(fixture);
    fixture.inspection = (...args) => { const r = inspection(...args); r.availability.model = false; return r; };
    const selections = new HubSelections(() => service, () => {}, {}, v => commits.push(v));
    await selections.inspectOptions(); const blocked = { defaults: selections.defaults, commits: commits.length };
    fixture.inspection = inspection; await selections.inspectOptions();
    return { blocked, unresolved: entryDefaultsToDesired(selections.defaults, selections.catalog).unresolved };
  });
  expect(result.blocked).toEqual({ defaults: {}, commits: 0 }); expect(result.unresolved).toEqual(['root']);
});
