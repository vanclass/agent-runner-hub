import { configurationSelection } from '../native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../native/webdriver/runner-read-only.mjs';
import { watchObservations } from '../native/webdriver/runner-flow.mjs';
import { HubActions } from '../native/webdriver/hub-actions.mjs';
import { domInteractions } from '../native/webdriver/dom-interactions.mjs';

// Executes feature assertions against synthetic transport. This is not native acceptance.
export function registerWG3({ test, expect, transport, configure }) {
  const testBrowser = page => ({
    options: { waitforTimeout: 10_000 },
    execute: (fn, ...args) => page.evaluate(({ source, args }) => (0, eval)('(' + source + ')')(...args),
      { source: fn.toString(), args }),
    waitUntil: async predicate => { await expect.poll(predicate).toBeTruthy(); }
  });
  test('WG3 simulated DOM interaction contract', async ({ page }) => {
    await page.goto('/');
    await domInteractions.run(testBrowser(page));
  });
  for (const [factory, unbound] of [[configurationSelection, false], [runnerReadOnly, false], [runnerReadOnly, true]]) {
    const spec = factory('/fixture/install', 'C:/fixture/test-root');
    test('WG3 simulated case contract: ' + spec.id + (unbound ? ' unbound draft' : ''), async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true });
      await page.goto('/');
      const browser = testBrowser(page);
      const hub = new HubActions(browser);
      await configure(page);
      await watchObservations(browser);
      await page.evaluate(() => {
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        native.invoke = async (command, args) => {
          if (command === 'runner_observe' && window.__nativeFixture.closed.includes(args.id))
            return Promise.reject('Unknown or exited PTY');
          const result = await invoke(command, args);
          if (command === 'runner_observe' && result.observation)
            result.observation.configured_startup_agent_id = 'codex';
          return result;
        };
        const session = window.__nativeFixture.sessions.get('pty-1');
        session.feature.features.runnerRoot = '/fixture/install';
        delete session.feature.features.sessionConfig.test_account_selection;
        const fixture = session.feature.config, inspect = fixture.inspection.bind(fixture);
        fixture.inspection = (...args) => {
          const reply = inspect(...args), current = fixture.current;
          reply.effective = { agent_id: current.account.agent_id, account: current.account.profile_name, model: current.model.id,
            reasoning_effort: current.model.reasoning_effort, service_tier: current.service_tier,
            source: 'configuration', next_model: current.model.id,
            next_reasoning_effort: current.model.reasoning_effort, next_service_tier: current.service_tier };
          return reply;
        };
      });
      await hub.openConfiguration();
      if (unbound) {
        await hub.edit('account', null);
        await hub.edit('model', null);
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
