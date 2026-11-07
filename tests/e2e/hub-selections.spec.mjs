import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

const key = 'agent-runner-hub.preferences.v1';
for (const draft of [{ allocationPolicy: 'reuse-idle' }, { root: 'C:/explicit' }]) {
  test('current non-execution draft can initialize: ' + JSON.stringify(draft), async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async draft => {
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { service, fixture } = createConfigHarness(), commits = [];
      const choices = new HubSelections(() => service, () => {}, {}, v => commits.push(v), () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
      for (const [key, value] of Object.entries(draft)) choices.setDefault(key, value);
      const initialized = choices.initialized;
      await choices.inspectOptions();
      return { initialized, defaults: choices.defaults, commits };
    }, draft);
    expect(result.initialized).toBe(false);
    expect(result.defaults).toMatchObject({ ...draft, initialized: true,
      accountIdentity: { agent_id: 'codex', profile_name: 'first' } });
    expect(result.commits).toHaveLength(2);
  });
}
for (const account of ['first', 'second', { obsolete: true }]) for (const extra of [{},
  { allocationPolicy: 'reuse-idle' }, { root: 'C:/saved' }, { allocationPolicy: 'always-new', root: 'C:/saved' }]) {
  test('inert saved label cannot initialize an account: ' + JSON.stringify({ account, extra }), async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ key, account, extra }) => {
      const { HubPreferences } = await import('/src/hub/preferences.ts');
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { entryDefaultsToDesired } = await import('/src/hub/runnerConfigDefaults.ts');
      const id = '12345678-1234-1234-1234-123456789abc';
      const raw = JSON.stringify({ version: 1, language: 'ko', theme: 'black', singleEntry: { account, ...extra },
        runnerSelections: { [id]: { account, ...extra } } });
      localStorage.setItem(key, raw);
      const store = new HubPreferences(), { service, fixture } = createConfigHarness(), commits = [];
      const choices = new HubSelections(() => service, () => {}, store.value.singleEntry, v => {
        commits.push(v); store.update({ singleEntry: v });
      }, () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
      await choices.inspectOptions(); choices.initialize();
      const tabCommits = [], tab = new HubSelections(() => service, () => {}, store.value.runnerSelections[id], v => {
        tabCommits.push(v); store.saveRunner(id, v);
      }, () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
      await tab.inspectOptions(); tab.initialize();
      const restored = { defaults: choices.defaults, desired: entryDefaultsToDesired(choices.defaults, choices.catalog).desired,
        raw, after: localStorage.getItem(key), commits: commits.length, issue: store.issue, tab: tab.defaults, tabCommits };
      const exact = choices.catalog.options.accounts[0];
      choices.setDefault('accountIdentity', exact);
      while (choices.loadingOptions) await new Promise(resolve => setTimeout(resolve, 0));
      return { ...restored, exact, saved: new HubPreferences().value.singleEntry,
        explicitDesired: entryDefaultsToDesired(choices.defaults, choices.catalog).desired };
    }, { key, account, extra });
    expect(result.defaults).toEqual({ initialized: true, ...extra });
    expect(result.desired).not.toHaveProperty('account'); expect(result.commits).toBe(0);
    expect(result.tab).toEqual(result.defaults); expect(result.tabCommits).toEqual([]);
    expect(result.saved.accountIdentity).toEqual(result.exact);
    expect(result.saved).not.toHaveProperty('account'); expect(result.explicitDesired.account).toEqual(result.exact);
    expect(result.after).toBe(result.raw); expect(result.issue).toBe('');
  });
}
test('mixed labels retain independent exact selections and only explicit edits save', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async key => {
    const { HubPreferences } = await import('/src/hub/preferences.ts');
    const id = '12345678-1234-1234-1234-123456789abc';
    const singleEntry = { initialized: true, accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run' };
    const tab = { initialized: true, accountIdentity: { agent_id: 'other', profile_name: 'first' }, runMode: 'issue-run' };
    const raw = JSON.stringify({ version: 1, language: 'ko', theme: 'black', singleEntry: { ...singleEntry, account: 'second' },
      runnerSelections: { [id]: { ...tab, account: 'first' } } });
    localStorage.setItem(key, raw); const store = new HubPreferences();
    const restored = structuredClone(store.value), before = localStorage.getItem(key);
    store.saveRunner(id, { ...store.value.runnerSelections[id], runMode: 'task-run' });
    const reopened = new HubPreferences();
    return { restored, raw, before, reopened: reopened.value, singleEntry, tab, id };
  }, key);
  expect(result.before).toBe(result.raw);
  expect(result.restored.singleEntry).toEqual(result.singleEntry);
  expect(result.restored.runnerSelections[result.id]).toEqual(result.tab);
  expect(result.reopened.singleEntry).toEqual(result.singleEntry);
  expect(result.reopened.runnerSelections[result.id]).toEqual({ ...result.tab, runMode: 'task-run' });
});

test('a removed saved account stays visible while interaction can choose a verified replacement', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { service, fixture } = createConfigHarness(), commits = [];
    const saved = { accountIdentity: { agent_id: 'removed', profile_name: 'retained' },
      model: { model: 'retained-model', reasoning_effort: 'high', service_tier: 'fast' } };
    const selections = new HubSelections(() => service, () => {}, saved, value => commits.push(value), () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
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

test('Hub initializes from current account rather than the first candidate and restores without inspecting', async ({ page }) => {
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
    }, () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
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
    accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run',
    model: { model: 'm0', reasoning_effort: 'medium', service_tier: 'default' } };
  expect(result.defaults).toEqual(expected); expect(result.restored).toEqual(expected); expect(result.commits).toEqual([expected]);
  expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
  expect(result.requests).toHaveLength(3);
  expect(result.requests.some(r => r.account)).toBe(false);
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
    const selections = new HubSelections(() => service, () => {}, saved, v => commits.push(v), () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
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
      const selections = new HubSelections(() => service, () => {}, {}, v => commits.push(v), () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
      await selections.inspectOptions(); const failed = { defaults: selections.defaults, detail: selections.detail, commits: commits.length };
      fixture.fault = ''; await selections.inspectOptions();
      return { failed, defaults: selections.defaults, commits, requests: fixture.requests };
    }, fault);
    expect(result.failed.defaults).toEqual({}); expect(result.failed.commits).toBe(0); expect(result.failed.detail).toBeTruthy();
    expect(result.commits).toHaveLength(1); expect(result.defaults.model.model).toBe('m0');
    expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
  });
}

test('Hub completes delayed initialization after a newer allocation edit', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { service, fixture } = createConfigHarness(), commits = [];
    fixture.hold = true;
    const selections = new HubSelections(() => service, () => {}, {}, v => commits.push(v), () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
    const pending = selections.inspectOptions();
    selections.setDefault('allocationPolicy', 'reuse-idle');
    fixture.hold = false; fixture.complete(); await pending;
    return { defaults: selections.defaults, commits, requests: fixture.requests };
  });
  expect(result.defaults).toMatchObject({ allocationPolicy: 'reuse-idle', initialized: true,
    accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run',
    model: { model: 'm0', reasoning_effort: 'medium', service_tier: 'default' } });
  expect(result.defaults.target.owner).toBe('Workspace');
  expect(result.defaults).not.toHaveProperty('root');
  expect(result.commits).toHaveLength(2);
  expect(result.commits[1]).toEqual(result.defaults);
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
    const selections = new HubSelections(() => service, () => {}, {}, v => commits.push(v), () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
    await selections.inspectOptions(); const blocked = { defaults: selections.defaults, commits: commits.length };
    fixture.inspection = inspection; await selections.inspectOptions();
    return { blocked, unresolved: entryDefaultsToDesired({ ...selections.defaults, runMode: 'direct-run' }, selections.catalog).unresolved };
  });
  expect(result.blocked).toEqual({ defaults: {}, commits: 0 }); expect(result.unresolved).toEqual(['root']);
});
