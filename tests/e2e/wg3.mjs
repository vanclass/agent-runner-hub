import { configurationSelection } from '../native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../native/webdriver/runner-read-only.mjs';
import { watchObservations } from '../native/webdriver/runner-flow.mjs';

// Executes feature assertions against synthetic transport. This is not native acceptance.
export function registerWG3({ test, expect, transport, configure }) {
  for (const factory of [configurationSelection, runnerReadOnly]) {
    const spec = factory('/fixture/install');
    test('WG3 simulated case contract: ' + spec.id, async ({ page }) => {
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
        session.feature.config.testSelection.runner_root = '/fixture/install';
      });
      const toggle = page.locator('.task-panel-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      const result = await spec.run(browser);
      expect(result.identity.session).toBe('pty-1');
      expect(result.workAdmission).toBe('not exercised');
      expect(result.workStart).toBe('not exercised');
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(session =>
        session.feature.requests.every(request => request.operation === 'work.list') &&
        session.feature.config.requests.every(request => request.operation === 'session_config.inspect')))).toBe(true);
    });
  }
}
