import { configurationSelection } from '../native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../native/webdriver/runner-read-only.mjs';
import { changeValue, watchObservations } from '../native/webdriver/runner-flow.mjs';

// Executes feature assertions against synthetic transport. This is not native acceptance.
export function registerWG3({ test, expect, transport, configure }) {
  for (const [factory, unbound] of [[configurationSelection, false], [runnerReadOnly, false], [runnerReadOnly, true]]) {
    const spec = factory('/fixture/install');
    test('WG3 simulated case contract: ' + spec.id + (unbound ? ' unbound draft' : ''), async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true });
      await page.goto('/');
      const browser = {
        options: { waitforTimeout: 10_000 },
        execute: (fn, ...args) => page.evaluate(({ source, args }) => (0, eval)('(' + source + ')')(...args),
          { source: fn.toString(), args }),
        waitUntil: async predicate => { await expect.poll(predicate).toBeTruthy(); }
      };
      await configure(page);
      await watchObservations(browser);
      await page.evaluate(() => {
        const session = window.__nativeFixture.sessions.get('pty-1');
        session.feature.features.runnerRoot = '/fixture/install';
        delete session.feature.features.sessionConfig.test_account_selection;
        const fixture = session.feature.config, inspect = fixture.inspection.bind(fixture);
        fixture.inspection = (...args) => {
          const reply = inspect(...args), current = fixture.current;
          reply.effective = { account: current.account.profile_name, model: current.model.id,
            reasoning_effort: current.model.reasoning_effort, service_tier: current.service_tier,
            source: 'configuration', next_model: current.model.id,
            next_reasoning_effort: current.model.reasoning_effort, next_service_tier: current.service_tier };
          return reply;
        };
      });
      const toggle = page.locator('.task-panel-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      if (unbound) {
        const selector = '.context-settings .account-settings select';
        await expect(page.locator(selector)).toBeEnabled();
        await changeValue(browser, selector, '');
        await expect(page.locator('.context-settings .model-settings select').first()).toBeEnabled();
        await changeValue(browser, '.context-settings .model-settings select', '');
      }
      const result = await spec.run(browser);
      expect(result.identity.session).toBe('pty-1');
      expect(result.workAdmission).toBe('not exercised');
      expect(result.workStart).toBe('not exercised');
      if (unbound) expect(result.uiBound).toEqual({ account: false, model: false });
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(session =>
        session.feature.requests.every(request => request.operation === 'work.list') &&
        session.feature.config.requests.every(request => request.operation === 'session_config.inspect'
          && !('execution_context' in request))))).toBe(true);
    });
  }
}
