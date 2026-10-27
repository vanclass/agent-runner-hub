import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test('late authoritative receipt resolves a delivery timeout only in the same live instance', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async () => {
    const harness = (await import('/tests/fixtures/sessionConfig.ts')).createConfigHarness();
    window.__lateConfig = harness;
    // Let ordinary fixture completions settle before holding apply.
    window.__prepareLate = (async () => {
      await harness.service.inspect();
      harness.service.setDraft({ run_mode: 'issue-run' });
      await harness.service.createPlan();
      harness.fixture.holdOperation = 'session_config.apply';
      window.__applyLate = harness.service.apply();
    })();
  });
  await page.clock.runFor(100);
  await expect.poll(() => page.evaluate(() => window.__lateConfig.fixture.requests.some(r => r.operation.endsWith('.apply')))).toBe(true);
  await page.evaluate(() => { window.__lateConfig.fixture.hold = true; });
  await page.clock.fastForward(1831000);
  await page.clock.runFor(100);
  expect(await page.evaluate(() => window.__lateConfig.service.uncertain)).toBe(true);
  await page.evaluate(() => window.__lateConfig.fixture.complete());
  const result = await page.evaluate(() => ({ uncertain: window.__lateConfig.service.uncertain,
    application: window.__lateConfig.service.latestApplication,
    count: window.__lateConfig.fixture.requests.filter(r => r.operation.endsWith('.apply')).length }));
  expect(result.uncertain).toBe(false);
  expect(result.application.result.results[0].outcome).toBe('success');
  expect(result.application.verification).toBe('unavailable');
  expect(result.count).toBe(1);
  await page.evaluate(async () => { window.__lateConfig.fixture.complete(); await window.__applyLate; });
});
