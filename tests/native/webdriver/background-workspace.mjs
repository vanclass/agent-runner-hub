import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { HubActions } from './hub-actions.mjs';
import { readyInstalledHub, visibleConnection } from './runner-flow.mjs';

const ordered = inventory => inventory.domains.flatMap(domain => domain.tabs.map(tab => tab.id));
const identity = connection => ({ tab: connection.tab, session: connection.session, generation: connection.generation });

export function backgroundWorkspace(runnerRoot) {
  return defineNativeCase({
    id: 'background-workspace', presentation: 'background',
    async ready(browser) {
      await browser.waitUntil(() => browser.execute(() => document.readyState === 'complete'
        && !!document.querySelector('.app-settings[open], .shell-body')));
    },
    async run(browser) {
      await readyInstalledHub(browser, runnerRoot);
      const hub = new HubActions(browser);
      const { tabs, settings, terminal, observations, logs } = hub;
      await settings.open();
      await settings.edit('language', 'ko');
      await settings.setTheme('black');
      await settings.edit('confirmRemoval', false);
      assert.equal((await settings.field('confirmRemoval')).checked, false);
      await settings.edit('confirmRemoval', true);
      await settings.edit('allocationPolicy', 'reuse-idle');
      await settings.edit('retentionDays', 7);
      await settings.edit('domainDisplay', 'run-mode');
      assert.equal((await settings.field('domainDisplay')).value, 'run-mode');
      await settings.edit('domainDisplay', 'unified');
      await settings.openShortcuts();
      await settings.captureShortcut('entry', 'F9', { code: 'F9' });
      assert.equal(await settings.shortcutIssue(), null);
      await settings.saveShortcuts();
      await settings.close();
      const first = await tabs.add('runner');
      const firstConnection = await visibleConnection(browser, runnerRoot);
      const second = await tabs.add('runner');
      const secondConnection = await visibleConnection(browser, runnerRoot);
      assert.notEqual(firstConnection.session, secondConnection.session);
      await tabs.rename(first, 'Background acceptance');
      assert.equal(await tabs.active(), first);
      assert.deepEqual(identity(await visibleConnection(browser, runnerRoot)), identity(firstConnection));
      await hub.wait(async () => (await observations.active())?.activity === 'idle', 'Runner did not reach authoritative idle');
      await hub.wait(async () => (await hub.field('mode'))?.options?.some(option =>
        option.value === 'pure-direct-run' && !option.disabled), 'Requested mode catalog unavailable');
      await hub.edit('mode', 'pure-direct-run');
      assert.equal((await settings.savedTab(first)).runMode, 'pure-direct-run');

      await hub.draft('runner', '/help');
      await hub.submit('runner');
      await hub.wait(async () => await terminal.find('/troubleshoot') >= 0, 'Read-only help missing from actual xterm');
      assert.deepEqual((await terminal.buffer()).identity, { tab: first, session: firstConnection.session });
      const scroll = await terminal.scroll('top');
      assert.equal(scroll.viewportY, 0);
      assert.ok(scroll.baseY > 0);
      await terminal.scroll('bottom');

      assert.equal(await tabs.reorder(second, 'runner', first), true);
      await hub.wait(async () => ordered(await tabs.inventory())[0] === second, 'Tab reorder did not commit');
      await tabs.navigate(first, 'ArrowUp');
      assert.ok((await hub.dom.state(await tabs.rowSelector(second) + ' .nav-row')).focused);
      await hub.dom.key(await tabs.rowSelector(first) + ' .nav-row', 'F9', { code: 'F9' });
      assert.ok((await tabs.inventory()).singleEntry, 'Configured shortcut must select Single Entry');
      const sequence = (await logs.history()).records.at(-1)?.sequence ?? 0;

      await tabs.restartAll();
      await hub.wait(async () => (await tabs.restartStatus()).pending === false, 'Global Runner restart did not settle');
      assert.deepEqual((await tabs.restartStatus()).failures, []);
      const history = await logs.history();
      assert.equal(history.issue, null);
      assert.ok(history.records.some(r => r.sequence > sequence && r.operation === 'runner-restarted'));
      const replaced = [];
      for (const connection of [firstConnection, secondConnection]) {
        await tabs.select(connection.tab);
        const replacement = await visibleConnection(browser, runnerRoot);
        assert.notEqual(replacement.session, connection.session);
        assert.equal(await observations.exited(connection.session), true);
        replaced.push(identity(replacement));
      }
      assert.deepEqual(ordered(await tabs.inventory()), [second, first]);
      return { first, second, replaced, scroll };
    },
    async afterRestart(browser, before) {
      const hub = new HubActions(browser);
      const { tabs, settings, observations } = hub;
      const { first, second } = before;
      const restored = await tabs.inventory();
      assert.deepEqual(ordered(restored), [second, first]);
      assert.equal(restored.domains[0].tabs[1].name, 'Background acceptance');
      assert.ok(restored.singleEntry);
      const preferences = await settings.saved();
      assert.equal(preferences.language, 'ko');
      assert.equal(preferences.theme, 'black');
      assert.equal(preferences.confirmRunnerRemoval, true);
      assert.equal(preferences.domainDisplay, 'unified');
      assert.equal(preferences.hubLogRetentionDays, 7);
      assert.equal(preferences.singleEntry.allocationPolicy, 'reuse-idle');
      assert.equal(preferences.shortcuts.entry, 'F9');
      await settings.open();
      assert.equal((await settings.field('language')).value, 'ko');
      assert.equal((await settings.appearance()).theme, 'black');
      assert.equal((await settings.field('retentionDays')).value, '7');
      await settings.close();
      await tabs.select(first);
      const connection = await visibleConnection(browser, runnerRoot);
      assert.equal(connection.tab, first);
      await hub.openConfiguration();
      await hub.wait(async () => (await hub.field('mode'))?.value === 'pure-direct-run', 'Saved tab mode was not restored');

      await tabs.requestRemoval(second);
      assert.ok(await tabs.removalPrompt());
      await tabs.cancelRemoval();
      assert.deepEqual(ordered(await tabs.inventory()), [second, first]);
      await tabs.select(second);
      const removedConnection = await visibleConnection(browser, runnerRoot);
      await hub.draft('runner', 'Keep this unsent draft out of the reuse pool.');
      await tabs.select(first);
      await tabs.requestRemoval(second);
      await tabs.confirmRemoval();
      await hub.wait(async () => ordered(await tabs.inventory()).length === 1, 'Confirmed Runner removal did not settle');
      assert.deepEqual(ordered(await tabs.inventory()), [first]);
      assert.deepEqual(identity(await visibleConnection(browser, runnerRoot)), identity(connection));
      assert.equal(await settings.savedTab(second), null);
      await hub.wait(() => observations.exited(removedConnection.session), 'Removed Runner with an unsent draft did not exit');
      return { restored, removed: identity(removedConnection), surviving: identity(connection) };
    }
  });
}
