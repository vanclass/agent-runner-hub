import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('test selection is read only and independent from a normal Hub account', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { service, fixture } = createConfigHarness('test-owned');
    const normal = createConfigHarness('normal', 2);
    await normal.service.inspect();
    const before = structuredClone(normal.fixture.current);
    const selected = await service.selectTestAccount();
    return { selected, unchanged: JSON.stringify(before) === JSON.stringify(normal.fixture.current),
      requests: fixture.requests, actual: fixture.current, draft: service.draft, applications: service.applications };
  });
  expect(result.selected.selection.account.profile_name).toBe('second');
  expect(result.selected.identity).toEqual({ session: 'test-owned', generation: 1 });
  expect(result.requests).toEqual([{ operation: 'session_config.inspect', api_version: 1, execution_context: 'test' }]);
  expect(result.actual.account.profile_name).toBe('first');
  expect(result.unchanged).toBe(true); expect(result.draft).toEqual({}); expect(result.applications).toEqual([]);
});

for (const fault of ['missing', 'authentication', 'unsupported', 'malformed', 'foreign-root', 'changed-root', 'stale-session', 'stale-generation', 'unknown']) {
  test(`test admission stops without fallback or mutation: ${fault}`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async fault => {
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { service, fixture, identity } = createConfigHarness();
      if (fault === 'missing') {
        fixture.testSelectionCode = 'TEST_ACCOUNT_PREREQUISITE';
        fixture.testSelection = { actual_result: 'Configured test profile missing', recommended_next_action: 'Configure the test profile in this installation' };
      }
      if (fault === 'authentication') fixture.testSelection.authentication = 'authentication_required';
      if (fault === 'unsupported') fixture.features.sessionConfig.test_account_selection = false;
      if (fault === 'malformed') delete fixture.testSelection.codex_home;
      if (fault === 'foreign-root') fixture.testSelection.runner_root = 'D:/Foreign';
      fixture.hold = true; fixture.changed();
      const selecting = service.selectTestAccount();
      if (fault === 'changed-root') { fixture.features.runnerRoot = 'D:/Changed'; fixture.changed(); }
      if (fault === 'stale-session') { identity.session = 'foreign'; }
      if (fault === 'stale-generation') { identity.generation++; fixture.features.generation++; fixture.changed(); }
      if (fault === 'unknown') service.close(); else fixture.complete();
      const selected = await selecting;
      return { selected, error: service.error, requests: fixture.requests, account: fixture.current.account,
        mutations: fixture.requests.filter(r => r.operation !== 'session_config.inspect').length };
    }, fault);
    expect(result.selected).toBeUndefined(); expect(result.mutations).toBe(0);
    expect(result.account.profile_name).toBe('first');
    expect(result.requests.length).toBe(fault === 'unsupported' ? 0 : 1);
    expect(result.error).toContain('/account → Test account settings');
    if (fault === 'missing') {
      expect(result.error).toContain('TEST_ACCOUNT_PREREQUISITE');
      expect(result.error).toContain('Configured test profile missing');
    }
  });
}

test('selected test catalog uses ordinary plan/apply and preserves authoritative setting receipts', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { service, fixture } = createConfigHarness();
    const selected = await service.selectTestAccount();
    await service.selectAccount(selected.selection.account);
    service.setDraft({ model: { id: 's0', reasoning_effort: 'high' }, service_tier: 'default' });
    await service.createPlan(); await service.apply();
    return { application: service.latestApplication, current: service.actual.current,
      effective: service.actual.effective, requests: fixture.requests };
  });
  expect(result.application.verification).toBe('verified');
  expect(result.application.result.results.every(r => r.outcome === 'success' && r.committed)).toBe(true);
  expect(result.current.account.profile_name).toBe('second'); expect(result.effective.account).toBe('second');
  expect(result.requests.filter(r => r.operation === 'session_config.apply')).toHaveLength(1);
  expect(result.requests.some(r => r.account?.profile_name === 'second')).toBe(true);
});

test('explicit test consumer configures before one work submission through ordinary Hub delivery', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerConfigService } = await import('/src/hub/RunnerConfigService.ts');
    const { RunnerWork } = await import('/src/hub/runnerWork.ts');
    const { submitConfiguredWork } = await import('/src/hub/runnerSubmission.ts');
    const { WorkFixture } = await import('/tests/fixtures/work.ts');
    const fixture = new WorkFixture('test-owned'), identity = { session: 'test-owned', generation: 1 };
    const config = new RunnerConfigService({ identity: () => identity, available: () => true,
      submit: (session, request) => fixture.config.submit(session, request) }, () => {});
    const work = new RunnerWork({ identity: () => identity, available: () => true,
      submit: (_, request) => fixture.submit(request) }, () => {});
    fixture.changed = () => {
      config.observe(identity.session, 'ready', structuredClone(fixture.features));
      work.observe(identity.session, 'ready', structuredClone(fixture.features));
    };
    fixture.changed();
    const selected = await config.selectTestAccount();
    await config.inspect(selected.selection.account);
    const model = config.catalog.options.models[0];
    const defaults = { accountIdentity: selected.selection.account,
      model: { model: model.id, reasoning_effort: model.reasoning_efforts[0], service_tier: model.service_tiers[0] } };
    const attempt = await submitConfiguredWork(config, work, defaults, 'original acceptance request', async () => {
      if (config.actual.effective.account !== selected.selection.account.profile_name) throw Error('Unverified effective account');
    });
    work.close();
    return { attempt, submissions: fixture.requests.filter(r => r.operation === 'work.submit'), application: config.latestApplication };
  });
  expect(result.submissions).toHaveLength(1);
  expect(result.submissions[0].instruction).toBe('original acceptance request');
  expect(result.application.verification).toBe('verified');
  expect(result.attempt.work.started_event_id).toBeGreaterThan(0);
});
