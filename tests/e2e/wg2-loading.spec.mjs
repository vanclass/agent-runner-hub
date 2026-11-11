import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';
for (const restored of [false, true]) for (const fail of [false, true]) {
  test(`WG2 delayed authenticated automatic loading restored=${restored} failure=${fail}`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ restored, fail }) => {
      const { HubSelections } = await import('/src/hub/HubSelections.ts');
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { service, fixture } = createConfigHarness();
      let ready = false;
      const saved = restored ? { initialized: true, runMode: 'obsolete-mode', accountIdentity: { agent_id: 'codex', profile_name: 'first' } } : {};
      const commits = [];
      const choices = new HubSelections(() => ready ? service : undefined, () => {}, saved, v => commits.push(v), () => true,
        () => ({ selection: { account: fixture.current.account.profile_name } }));
      for (let i = 0; i < 5; i++) choices.initialize();
      const before = { detail: choices.detail, requests: fixture.requests.length };
      ready = true; fixture.hold = true; fixture.fault = fail ? 'missing' : '';
      choices.initialize(); choices.initialize();
      choices.setDefault('allocationPolicy', 'reuse-same-mode');
      fixture.hold = false; fixture.complete();
      while (choices.loadingOptions) await new Promise(resolve => setTimeout(resolve, 5));
      const count = fixture.requests.length;
      for (let i = 0; i < 5; i++) choices.initialize();
      return { before, saved, defaults: choices.defaults, detail: choices.detail, catalog: !!choices.catalog,
        count, after: fixture.requests.length, commits };
    }, { restored, fail });
    expect(result.before).toEqual({ detail: '', requests: 0 });
    expect(result.count).toBeGreaterThan(0); expect(result.after).toBe(result.count);
    expect(result.defaults.allocationPolicy).toBe('reuse-same-mode');
    if (restored) expect(result.defaults).toMatchObject(result.saved);
    if (fail) { expect(result.catalog).toBe(false); expect(result.detail).toBeTruthy(); }
    else { expect(result.catalog).toBe(true); if (!restored) expect(result.defaults.runMode).toBe('task-run'); }
  });
}
