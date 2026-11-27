import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { readyInstalledHub, stopWatching } from './runner-flow.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { HubActions } from './hub-actions.mjs';

const geometry = browser => browser.execute(() => {
  const node = document.querySelector('.hub-log-records');
  const row = node?.querySelector('.hub-log-row:last-child');
  if (!node || !row) return null;
  const view = node.getBoundingClientRect(), latest = row.getBoundingClientRect();
  return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop,
    latestSequence: Number(row.dataset.sequence), bottomDistance: node.scrollHeight - node.clientHeight - node.scrollTop,
    latestVisible: latest.top >= view.top && latest.bottom <= view.top + node.clientHeight + 2,
    singleEntry: !!document.querySelector('.single-entry.active') };
});
export function hubLogCase(runnerRoot, displayed = false) {
  return defineNativeCase({
    id: displayed ? 'hub-log-presentation' : 'hub-log',
    presentation: displayed ? 'nonactivating' : 'background',
    async ready(browser) {
      await browser.waitUntil(async () => browser.execute(() => document.readyState === 'complete'
        && !!document.querySelector('.installation-setup[open], .shell-body')), { timeout: browser.options.waitforTimeout });
    },
    async run(browser) {
      const { tabs, logs, settings } = new HubActions(browser);
      await browser.execute(() => {
        window.__hubPendingSeen = false;
        new MutationObserver(mutations => {
          for (const mutation of mutations) for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && (node.matches('.hub-log-pending') || node.querySelector('.hub-log-pending')))
              window.__hubPendingSeen = true;
          }
        }).observe(document.body, { childList: true, subtree: true });
      });
      await readyInstalledHub(browser, runnerRoot);
      await browser.execute(async () => {
        // Safe fixture history belongs only to the suite's isolated app-local profile.
        for (let index = 0; index < 450; index++) {
          const result = await window.__TAURI_INTERNALS__.invoke('hub_log', { request: { retentionDays: 7,
            event: { component: 'system', operation: 'connection', runner: 'Overflow fixture', target: '',
              expected: 'confirmed-outcome', actual: 'ready', code: '', nextAction: '' } } });
          if (result.issue) throw new Error(result.issue);
        }
      });
      await tabs.add();
      assert.equal(await browser.execute(() => !!document.querySelector('.hub-log')), false);
      let disk;
      await browser.waitUntil(async () => {
        disk = await logs.history();
        return !disk.issue && disk.records.some(r => r.component === 'system' && r.operation === 'connection'
          && r.runner && r.runner !== 'Overflow fixture');
      }, { timeout: browser.options.waitforTimeout });
      await tabs.selectSingleEntry();
      await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.hub-log-row').length > 0),
        { timeout: browser.options.waitforTimeout });
      disk = await logs.history();
      const latest = Math.max(...disk.records.map(r => r.sequence));
      await browser.waitUntil(async () => (await logs.rows()).at(-1)?.sequence >= latest,
        { timeout: browser.options.waitforTimeout, timeoutMsg: 'Native history did not reach the log viewport' });
      // Establish the following-reader state before observing an independent live append.
      await logs.scrollToBottom();
      let before;
      await browser.waitUntil(async () => {
        before = await geometry(browser);
        return before?.singleEntry && before.latestSequence >= latest
          && before.scrollHeight > before.clientHeight && before.bottomDistance <= 2 && before.latestVisible;
      }, { timeout: browser.options.waitforTimeout, timeoutMsg: 'Expected overflowing bottom-following log before restart' })
        .catch(error => { throw new Error(error.message + ': ' + JSON.stringify({ latest, before })); });
      assert.ok(before.scrollTop > 0);
      await tabs.restartAll();
      await browser.waitUntil(async () => {
        disk = await logs.history();
        return disk.records.some(r => r.sequence > latest && r.operation === 'runner-restarted');
      }, { timeout: startupMs, timeoutMsg: 'No confirmed restart event while Single Entry remained open' }).catch(async error => {
        throw new Error(JSON.stringify({ message: error.message, before, after: await geometry(browser),
          recentEvents: disk.records.slice(-8).map(({ sequence, operation, actual, code }) =>
            ({ sequence, operation, actual, code })) }));
      });
      const appended = disk.records.find(r => r.sequence > latest && r.operation === 'runner-restarted');
      await browser.waitUntil(async () => browser.execute(sequence =>
        !!document.querySelector(`.hub-log-row[data-sequence="${sequence}"]`), appended.sequence),
      { timeout: browser.options.waitforTimeout });
      let after;
      await browser.waitUntil(async () => {
        after = await geometry(browser);
        return after?.singleEntry && after.latestSequence >= appended.sequence && after.latestVisible
          && after.scrollHeight > before.scrollHeight && after.scrollTop > before.scrollTop + 2
          && after.bottomDistance <= 2;
      }, { timeout: browser.options.waitforTimeout,
        timeoutMsg: 'Rendered restart row did not move the overflowing viewport down to the latest row' });
      const liveAppend = { operation: 'runner-restarted', renderedSequence: appended.sequence, before, after };
      const pagination = [];
      while (await browser.execute(() => document.querySelectorAll('.hub-log-row').length) < disk.records.length) {
        const previous = await browser.execute(() => {
          const node = document.querySelector('.hub-log-records');
          const row = node.querySelector('.hub-log-row');
          node.scrollTop = 0;
          return { count: node.children.length, sequence: row.dataset.sequence,
            offset: row.getBoundingClientRect().top - node.getBoundingClientRect().top };
        });
        await browser.waitUntil(async () => browser.execute(count =>
          document.querySelectorAll('.hub-log-row').length >= count + 1, previous.count),
        { timeout: browser.options.waitforTimeout });
        const current = await browser.execute(sequence => {
          const node = document.querySelector('.hub-log-records');
          const row = node.querySelector(`[data-sequence="${sequence}"]`);
          return { count: node.children.length, offset: row.getBoundingClientRect().top - node.getBoundingClientRect().top };
        }, previous.sequence);
        assert.ok(Math.abs(current.offset - previous.offset) <= 1, 'Prepended native rows retain their offset');
        assert.equal(current.count, Math.min(previous.count + 200, disk.records.length));
        pagination.push({ previous, current });
      }
      const expandedGeometry = await browser.execute(() => {
        const region = document.querySelector('.hub-log'), node = region.querySelector('.hub-log-records');
        node.scrollTop = 0;
        return { headerAbsent: !region.querySelector('.terminal-tools, button'),
          topGap: node.getBoundingClientRect().top - region.getBoundingClientRect().top,
          sequences: [...node.children].map(row => Number(row.dataset.sequence)) };
      });
      assert.ok(expandedGeometry.headerAbsent);
      assert.equal(expandedGeometry.topGap, 0);
      assert.deepEqual(expandedGeometry.sequences, disk.records.map(row => row.sequence));
      await logs.scrollToBottom();
      await settings.edit('retentionDays', 7);
      await browser.waitUntil(async () => (await settings.saved())?.hubLogRetentionDays === 7);
      const lines = (await logs.rows()).map(row => row.text);
      assert.equal(await browser.execute(() => window.__hubPendingSeen), false, 'Startup and spare events must not insert temporary pending messages');
      assert.equal(await browser.execute(() => !!document.querySelector('.hub-log-records .hub-log-pending, .hub-log-records [role="alert"]')), false);
      disk = await logs.history(); assert.equal(disk.issue, null);
      assert.ok(lines.length > 0); assert.ok(disk.records.length >= lines.length);
      await stopWatching(browser);
      return { method: 'Candidate native Hub; actual Runner tab and app-local disk; no instruction submission', disk, lines, liveAppend, pagination, expandedGeometry };
    },
    async afterRestart(browser, before) {
      const { tabs, logs, settings } = new HubActions(browser);
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.installation-setup[open]')),
        { timeout: browser.options.waitforTimeout });
      await tabs.selectSingleEntry();
      await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.hub-log-row').length > 0),
        { timeout: browser.options.waitforTimeout });
      let disk;
      await browser.waitUntil(async () => {
        disk = await logs.history();
        return disk.records.length > before.disk.records.length;
      }, { timeout: browser.options.waitforTimeout, timeoutMsg: 'Fresh startup events append after old history' });
      assert.equal(disk.issue, null);
      for (const old of before.disk.records) assert.deepEqual(disk.records.find(r => r.sequence === old.sequence), old);
      while (await browser.execute(() => document.querySelectorAll('.hub-log-row').length) < disk.records.length) {
        const count = (await logs.rows()).length;
        await logs.scroll({ top: 0 });
        await browser.waitUntil(async () => (await logs.rows()).length > count);
      }
      const lines = (await logs.rows()).map(row => row.text);
      for (const old of before.lines) assert.ok(lines.includes(old), 'Restored formatter must be byte-identical');
      assert.equal(new Set(disk.records.map(r => r.sequence)).size, disk.records.length);
      assert.ok(disk.records.length > before.disk.records.length, 'Fresh startup events append after old history');
      const days = (await settings.saved()).hubLogRetentionDays;
      assert.equal(days, 7);
      await logs.scrollToBottom();
      return { recordsBefore: before.disk.records.length, recordsAfter: disk.records.length,
        formatAndOrderRetained: true, retentionDays: days, duplicateSequences: false };
    },
    async observe(browser) {
      const view = await browser.execute(() => ({ lines: document.querySelectorAll('.hub-log-row').length,
        theme: document.querySelector('.hub').dataset.theme, error: document.querySelector('.hub-log [role="alert"]')?.textContent,
        style: getComputedStyle(document.querySelector('.hub-log-row')).fontFamily,
        columns: [...document.querySelector('.hub-log-row').children].map(n => n.className),
        atBottom: (() => { const n = document.querySelector('.hub-log-records'); return n.scrollHeight - n.scrollTop - n.clientHeight <= 2; })() }));
      assert.ok(view.lines); assert.ok(!view.error); assert.match(view.style, /monospace|Consolas/);
      assert.equal(view.columns.length, 3);
      assert.equal(view.columns[0], 'hub-log-time'); assert.equal(view.columns[1], 'hub-log-category');
      assert.match(view.columns[2], /^hub-log-message (normal|success|warning|failure)$/);
      assert.ok(view.atBottom);
      return view;
    }
  });
}
