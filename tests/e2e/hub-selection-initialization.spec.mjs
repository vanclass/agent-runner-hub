import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

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
      const restart = new HubSelections(() => { throw Error('unexpected restart inspection'); }, () => {}, restored.singleEntry);
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

test('allocation-only preferences allow initialization and stale sources cannot commit or retry automatically', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { HubSelections } = await import('/src/hub/HubSelections.ts');
    const first = createConfigHarness(), next = createConfigHarness();
    let source = first.service;
    const commits = [];
    const selections = new HubSelections(() => source, () => {}, { allocationPolicy: 'reuse-idle' }, v => commits.push(v), () => true, () => ({ selection: { account: (source === first.service ? first : next).fixture.current.account.profile_name } }));
    first.fixture.hold = true;
    selections.initialize();
    source = next.service;
    first.fixture.hold = false; first.fixture.complete();
    while (selections.loadingOptions) await new Promise(resolve => setTimeout(resolve, 5));
    selections.initialize();
    const stale = { defaults: selections.defaults, catalog: selections.catalog, commits: commits.length,
      requests: next.fixture.requests.length };
    await selections.inspectOptions();
    return { stale, defaults: selections.defaults, commits };
  });
  expect(result.stale).toEqual({ defaults: { allocationPolicy: 'reuse-idle' }, commits: 0, requests: 0 });
  expect(result.defaults.model.model).toBe('m0'); expect(result.defaults.allocationPolicy).toBe('reuse-idle');
  expect(result.commits).toHaveLength(1);
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
