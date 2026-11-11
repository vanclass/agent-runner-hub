import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

for (const recovery of ['replacement', 'readiness']) {
  test(`failed automatic inspection recovers on ${recovery} only`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async recovery => {
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const first = createConfigHarness(), next = createConfigHarness();
      let source = first.service;
      const choices = new HubSelections(() => source, () => {}, { runMode: 'issue-run' });
      const settle = async () => { while (choices.loadingOptions) await new Promise(r => setTimeout(r, 5)); };
      first.fixture.fault = 'missing'; choices.initialize(); await settle();
      const failed = first.fixture.requests.length;
      for (let i = 0; i < 5; i++) choices.initialize();
      const unchanged = first.fixture.requests.length;
      if (recovery === 'readiness') { source = undefined; choices.initialize(); }
      source = recovery === 'replacement' ? next.service : first.service;
      first.fixture.fault = ''; choices.initialize(); await settle();
      return { failed, unchanged, catalog: !!choices.catalog, defaults: choices.defaults };
    }, recovery);
    expect(result.failed).toBeGreaterThan(0); expect(result.unchanged).toBe(result.failed);
    expect(result.catalog).toBe(true); expect(result.defaults).toEqual({ runMode: 'issue-run' });
  });
}

for (const field of ['root', 'target', 'accountIdentity', 'runMode', 'model']) {
  test(`pending first-run inspection preserves explicit ${field} edits and clears`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async field => {
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const { HubPreferences } = await import('/src/hub/preferences.ts');
      const { service, fixture } = createConfigHarness();
      const preferences = new HubPreferences(), commits = [];
      const id = '12345678-1234-1234-1234-123456789abc';
      const tab = { runMode: 'task-run', initialized: true };
      preferences.saveRunner(id, tab);
      const selections = new HubSelections(() => service, () => {}, {}, value => {
        commits.push(value); preferences.update({ singleEntry: value });
      }, () => true, () => ({ selection: { account: fixture.current.account.profile_name } }));
      fixture.hold = true;
      const pending = selections.inspectOptions();
      if (field === 'root') selections.setDefault('root', 'C:\\explicit-root');
      else selections.setDefault(field, undefined);
      selections.setDefault('allocationPolicy', 'reuse-idle');
      preferences.update({ language: 'ko', theme: 'black' });
      fixture.hold = false; fixture.complete(); await pending;
      const defaults = selections.defaults;
      const restored = new HubPreferences().value;
      const restart = new HubSelections(() => undefined, () => {}, restored.singleEntry);
      restart.initialize();
      return { defaults, restored, restart: restart.defaults, commits, tab, id, requests: fixture.requests };
    }, field);
    expect(result.defaults.initialized).toBe(true);
    expect(result.defaults.allocationPolicy).toBe('reuse-idle');
    if (field === 'root') expect(result.defaults.root).toBe('C:\\explicit-root');
    else expect(result.defaults).not.toHaveProperty(field);
    if (field !== 'target') expect(result.defaults.target.owner).toBe('Workspace');
    if (field !== 'runMode') expect(result.defaults.runMode).toBe('task-run');
    if (!['model', 'accountIdentity'].includes(field)) expect(result.defaults.model.model).toBe('m0');
    if (field === 'accountIdentity') expect(result.defaults).not.toHaveProperty('model');
    expect(result.restored.singleEntry).toEqual(result.defaults);
    expect(result.restart).toEqual(result.defaults);
    expect(result.restored.runnerSelections[result.id]).toEqual(result.tab);
    expect(result.restored.language).toBe('ko'); expect(result.restored.theme).toBe('black');
    expect(result.commits.at(-1)).toEqual(result.defaults);
    expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
  });
}

test('allocation-only preferences survive stale completion and automatically inspect the replacement', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const first = createConfigHarness(), next = createConfigHarness();
    let source = first.service;
    const commits = [];
    const selections = new HubSelections(() => source, () => {}, { allocationPolicy: 'reuse-idle' }, v => commits.push(v), () => true, () => ({ selection: { account: (source === first.service ? first : next).fixture.current.account.profile_name } }));
    first.fixture.hold = true;
    next.fixture.hold = true;
    selections.initialize();
    source = next.service;
    first.fixture.hold = false; first.fixture.complete();
    while (!next.fixture.requests.length) await new Promise(resolve => setTimeout(resolve, 5));
    const stale = { defaults: selections.defaults, catalog: selections.catalog, commits: commits.length,
      requests: next.fixture.requests.length };
    next.fixture.hold = false; next.fixture.complete();
    while (selections.loadingOptions) await new Promise(resolve => setTimeout(resolve, 5));
    return { stale, defaults: selections.defaults, commits };
  });
  expect(result.stale.defaults).toEqual({ allocationPolicy: 'reuse-idle' });
  expect(result.stale.catalog).toBeUndefined();
  expect(result.stale.commits).toBe(0); expect(result.stale.requests).toBeGreaterThan(0);
  expect(result.defaults.model.model).toBe('m0'); expect(result.defaults.allocationPolicy).toBe('reuse-idle');
  expect(result.commits).toHaveLength(1);
});

for (const unbound of [false, true]) test(`verified same-session readiness recovers retained catalog, unbound=${unbound}`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async unbound => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const { service, fixture } = createConfigHarness();
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const { default: React } = await import(resources.find(url => /\/react\.js\?/.test(url)));
    const { default: { createRoot } } = await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)));
    const { HubSelectionSettings } = await import('/src/hub/SingleEntryComposer.tsx');
    const host = document.createElement('div'); host.id = 'recovered-settings'; document.body.append(host);
    const root = createRoot(host);
    const render = () => root.render(React.createElement(HubSelectionSettings, { entry: selections }));
    let observation, editable = true;
    if (unbound) { fixture.current.target = ''; fixture.hold = true; }
    const selections = new HubSelections(() => service, render, {}, () => {}, () => editable, () => observation);
    selections.initialize();
    if (unbound) { editable = false; fixture.hold = false; fixture.complete(); }
    while (selections.loadingOptions) await new Promise(r => setTimeout(r, 5));
    const initial = { defaults: selections.defaults, catalog: !!selections.catalog, verified: !!service.catalog, detail: selections.detail };
    const requests = fixture.requests.length;
    editable = true;
    observation = { selection: { account: 'unrelated' } }; selections.initialize();
    const unrelated = { ...selections.defaults };
    observation = { selection: { account: fixture.current.account.profile_name }, target: { binding_state: 'unset', owner: '', project: '' } }; selections.initialize();
    return { initial, unrelated, defaults: selections.defaults, catalog: !!selections.catalog, requests, after: fixture.requests.length };
  }, unbound);
  expect(result.initial).toMatchObject({ defaults: {}, catalog: false, verified: true, detail: { key: 'config.incomplete' } });
  expect(result.unrelated).toEqual({});
  expect(result.catalog).toBe(true);
  if (unbound) expect(result.defaults).toEqual({});
  else expect(result.defaults.model.model).toBe('m0');
  expect(result.after).toBe(result.requests);
  const settings = page.locator('#recovered-settings');
  const account = settings.getByRole('combobox', { name: 'Requested Account', exact: true });
  await expect(account).toBeEnabled();
  await account.selectOption({ label: 'codex / first' });
  await expect(account).toHaveValue(JSON.stringify({ agent_id: 'codex', profile_name: 'first' }));
});

for (const available of [true, false]) {
  test('current account and non-first model initialize only with fresh observation: ' + available, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async available => {
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const { service, fixture } = createConfigHarness(), commits = [];
      fixture.current = { ...fixture.current, account: fixture.accounts[1], target: 'project:Exact',
        model: { id: 's2', reasoning_effort: 'high' }, service_tier: 'fast', run_mode: 'issue-run' };
      const selection = new HubSelections(() => service, () => {}, {}, value => commits.push(value), () => true,
        () => available ? { selection: { account: fixture.current.account.profile_name } } : undefined);
      await selection.inspectOptions();
      return { defaults: selection.defaults, commits, detail: selection.detail, requests: fixture.requests };
    }, available);
    expect(result.requests.every(r => r.operation === 'session_config.inspect')).toBe(true);
    if (available) {
      expect(result.defaults).toEqual({ initialized: true, target: { binding_state: 'bound', owner: 'Project', project: 'Exact' },
        accountIdentity: { agent_id: 'codex', profile_name: 'second' }, runMode: 'task-run',
        model: { model: 's2', reasoning_effort: 'high', service_tier: 'fast' } });
      expect(result.commits).toHaveLength(1);
    } else {
      expect(result.defaults).toEqual({}); expect(result.commits).toEqual([]); expect(result.detail).toBeTruthy();
    }
  });
}
