import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('session config binds identity only after an authenticated ready snapshot', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RunnerConfigService } = await import('/src/hub/RunnerConfigService.ts');
    const { ConfigFixture } = await import('/tests/fixtures/sessionConfig.ts');
    const fixture = new ConfigFixture('startup', 7), identity = { session: 'startup', generation: 7 };
    const service = new RunnerConfigService({ identity: () => identity, available: () => true,
      submit: (id, request) => fixture.submit(id, request) }, () => {});
    service.observe('startup', 'connecting', { generation: 0, sessionConfig: null, results: [] });
    fixture.changed = () => service.observe('startup', 'ready', structuredClone(fixture.features));
    fixture.changed(); await service.inspect();
    return { activity: service.activity, identity: service.catalog.identity };
  });
  expect(result).toEqual({ activity: 'idle', identity: { session: 'startup', generation: 7 } });
});

test('session config verifies destination pages and preserves exact plan/apply evidence', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { service, fixture } = createConfigHarness();
    await service.inspect();
    const first = service.catalog.options.models.map(m => m.id);
    await service.selectAccount(fixture.accounts[1]);
    const destination = service.catalog.options.models.map(m => m.id);
    const unchanged = fixture.current.account.profile_name;
    await service.createPlan();
    const invalid = !service.plan;
    service.setDraft({ model: { id: 's0', reasoning_effort: 'high' }, service_tier: 'fast',
      run_mode: 'direct-run', root: 'C:/explicit-root', target: 'project:Exact' });
    await service.createPlan();
    const plan = structuredClone(service.plan);
    await service.apply();
    return { first, destination, unchanged, invalid, plan,
      requests: fixture.requests, result: service.latestApplication, actual: service.actual.current };
  });
  expect(result.first).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  expect(result.destination).toEqual(['s0', 's1', 's2', 's3', 's4']);
  expect(result.unchanged).toBe('first'); expect(result.invalid).toBe(true);
  const request = result.requests.find(r => r.operation === 'session_config.apply');
  expect(request.desired).toEqual(result.plan.desired); expect(request.revision).toBe(result.plan.revision);
  expect(request.plan_id).toBe(result.plan.plan_id); expect(request).not.toHaveProperty('options_revision');
  const pages = result.requests.filter(r => r.operation === 'session_config.inspect' && r.account);
  expect(pages.map(r => r.offset)).toEqual([0, 2, 4]);
  expect(pages.slice(1).every(p => p.options_revision === 'b'.repeat(64))).toBe(true);
  expect(result.result.result.results.every(r => r.outcome === 'success')).toBe(true);
  expect(result.result.verification).toBe('verified'); expect(result.actual.account.profile_name).toBe('second');
});

for (const fault of ['token', 'revision', 'totals', 'account', 'offset', 'next', 'duplicate', 'unavailable', 'short', 'missing']) {
  test(`session config discards the entire list on ${fault} page evidence`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async fault => {
      const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
      const { service, fixture } = createConfigHarness(); fixture.fault = fault;
      await service.inspect(); const discarded = service.catalog === undefined;
      fixture.fault = ''; await service.inspect();
      return { discarded, complete: service.catalog?.options.models.length,
        offsets: fixture.requests.filter(r => r.operation === 'session_config.inspect').map(r => r.offset) };
    }, fault);
    expect(result.discarded).toBe(true); expect(result.complete).toBe(5);
    expect(result.offsets).toEqual([0, 2, 0, 2, 4]);
  });
}

test('legacy config never merges unguarded pages and still permits a proven complete single page', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const { service, fixture } = createConfigHarness('legacy', 1, false);
    await service.inspect(); const incomplete = !service.catalog, requests = fixture.requests.length;
    const original = fixture.inspection.bind(fixture);
    fixture.inspection = (...args) => {
      const page = original(...args); page.options.models = page.options.models.slice(0, 1); page.options.accounts = page.options.accounts.slice(0, 2);
      page.options_page = { offset: 0, totals: { targets: 2, accounts: 2, models: 1 }, next_offset: null };
      return page;
    };
    await service.inspect(); return { incomplete, requests, complete: !!service.catalog };
  });
  expect(result).toEqual({ incomplete: true, requests: 1, complete: true });
});

for (const status of ['invalid', 'confirmation_required']) {
  test(`session config disables apply for ${status} plans`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async status => {
      const { service, fixture } = (await import('/tests/fixtures/sessionConfig.ts')).createConfigHarness();
      await service.inspect(); service.setDraft({ run_mode: 'issue-run' }); fixture.planStatus = status;
      await service.createPlan(); await service.apply();
      return { status: service.plan.plan_status, canApply: service.canApply, applyCount: fixture.requests.filter(r => r.operation.endsWith('.apply')).length };
    }, status);
    expect(result).toEqual({ status, canApply: false, applyCount: 0 });
  });
}

test('draft edits and fresh Runner state invalidate plans without silently replanning', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { service, fixture } = (await import('/tests/fixtures/sessionConfig.ts')).createConfigHarness();
    await service.inspect(); service.setDraft({ run_mode: 'issue-run' }); await service.createPlan();
    service.setDraft({ run_mode: 'direct-run', root: 'C:/root' }); const edited = !service.canApply && !service.plan;
    await service.createPlan(); fixture.revision = 'f'.repeat(64); await service.apply();
    return { edited, stale: !service.plan, applyCount: fixture.requests.filter(r => r.operation.endsWith('.apply')).length };
  });
  expect(result).toEqual({ edited: true, stale: true, applyCount: 0 });
});

for (const outcome of ['partial', 'cancelled', 'failed', 'unknown']) {
  test(`session config preserves ${outcome} owner results and prior receipts`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async outcome => {
      const { service, fixture } = (await import('/tests/fixtures/sessionConfig.ts')).createConfigHarness();
      await service.inspect(); service.setDraft({ model: { id: 'm2', reasoning_effort: 'high' }, service_tier: 'fast', run_mode: 'issue-run' });
      await service.createPlan(); fixture.applyOutcome = outcome; await service.apply();
      fixture.current.run_mode = 'issue-run'; await service.inspect();
      await service.apply();
      return { application: service.latestApplication, uncertain: service.uncertain,
        count: fixture.requests.filter(r => r.operation.endsWith('.apply')).length };
    }, outcome);
    expect(result.application.result.apply_status).toBe(outcome);
    expect(result.application.result.results.map(r => r.outcome)).toEqual(outcome === 'partial'
      ? ['success', 'failed', 'not_attempted'] : [outcome, 'not_attempted', 'not_attempted']);
    expect(result.uncertain).toBe(outcome === 'unknown'); expect(result.count).toBe(1);
  });
}

test('confirmed commits survive failure of the final inspect', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { service, fixture } = (await import('/tests/fixtures/sessionConfig.ts')).createConfigHarness();
    await service.inspect(); service.setDraft({ run_mode: 'issue-run' }); await service.createPlan();
    fixture.postApplyFailure = true; await service.apply();
    return service.latestApplication;
  });
  expect(result.result.results[0].outcome).toBe('success'); expect(result.verification).toBe('unavailable');
});

test('queued and terminal interactions are not commits; close fences late receipts to the owning session', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createConfigHarness } = await import('/tests/fixtures/sessionConfig.ts');
    const a = createConfigHarness('first', 1), b = createConfigHarness('second', 2);
    a.fixture.hold = true; const pending = a.service.inspect(); await new Promise(r => setTimeout(r, 0));
    const queued = { state: a.service.progress.state, actual: a.service.actual };
    const receipt = a.fixture.features.results.at(-1); receipt.state = 'pending-interaction'; receipt.phase = 'awaiting_interaction'; a.fixture.changed();
    const interacting = a.service.progress.state;
    a.service.close(); await pending; a.fixture.complete(); await b.service.inspect();
    return { queued, interacting, closed: a.service.activity, late: a.service.actual, other: b.service.catalog.identity.session };
  });
  expect(result.queued).toEqual({ state: 'queued', actual: undefined }); expect(result.interacting).toBe('pending-interaction');
  expect(result.closed).toBe('closed'); expect(result.late).toBeUndefined(); expect(result.other).toBe('second');
});

test('saved defaults map exact candidate IDs and refuse to infer account identity from profile labels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { service } = (await import('/tests/fixtures/sessionConfig.ts')).createConfigHarness(); await service.inspect();
    const { entryDefaultsToDesired, configToEntryDefaults } = await import('/src/hub/runnerConfigDefaults.ts');
    const defaults = { target: { binding_state: 'bound', owner: 'Project', project: 'Exact' }, account: 'second',
      model: { model: 'm0', reasoning_effort: 'high', service_tier: 'fast' }, runMode: 'direct-run' };
    const unproven = entryDefaultsToDesired(defaults, service.catalog);
    const observation = { selection: service.actual.effective };
    const matchingLabel = entryDefaultsToDesired({ ...defaults, account: 'first' }, service.catalog);
    const explicitIds = entryDefaultsToDesired({ model: defaults.model, target: defaults.target, runMode: defaults.runMode }, service.catalog);
    const saved = configToEntryDefaults(service.actual.current, service.catalog, observation);
    return { unproven, matchingLabel, explicitIds, saved };
  });
  expect(result.unproven.unresolved).toEqual(['account', 'model']);
  expect(result.unproven.desired).toEqual({ target: 'project:Exact', run_mode: 'direct-run' });
  expect(result.matchingLabel.unresolved).toEqual(['account', 'model']);
  expect(result.matchingLabel.desired).not.toHaveProperty('account');
  expect(result.explicitIds.unresolved).toEqual([]);
  expect(result.explicitIds.desired.model).toEqual({ id: 'm0', reasoning_effort: 'high' });
  expect(result.explicitIds.desired.service_tier).toBe('fast');
  expect(result.saved).toEqual({ target: { binding_state: 'bound', owner: 'Workspace', project: '' }, accountIdentity: { agent_id: 'codex', profile_name: 'first' }, runMode: 'task-run',
    model: { model: 'm0', reasoning_effort: 'medium', service_tier: 'default' } });
});
