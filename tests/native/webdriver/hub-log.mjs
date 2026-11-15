import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { readyInstalledHub, stopWatching } from './runner-flow.mjs';

const read = browser => browser.execute(() => window.__TAURI_INTERNALS__.invoke('hub_log',
  { request: { retentionDays: 7, event: null } }));
export function hubLogCase(runnerRoot) {
  return defineNativeCase({
    id: 'hub-log', presentation: 'nonactivating',
    async ready(browser) {
      await browser.waitUntil(async () => browser.execute(() => document.readyState === 'complete'
        && !!document.querySelector('.app-settings[open], .shell-body')), { timeout: browser.options.waitforTimeout });
    },
    async run(browser) {
      await readyInstalledHub(browser, runnerRoot);
      await browser.execute(() => document.querySelector('.add-runner').click());
      await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.runner-row.active')),
        { timeout: browser.options.waitforTimeout });
      assert.equal(await browser.execute(() => !!document.querySelector('.hub-log')), false);
      let disk;
      await browser.waitUntil(async () => {
        disk = await read(browser);
        return !disk.issue && disk.records.some(r => r.component === 'system' && r.operation === 'connection' && r.runner);
      }, { timeout: browser.options.waitforTimeout });
      await browser.execute(() => document.querySelector('.single-entry').click());
      await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.hub-log-row').length > 0),
        { timeout: browser.options.waitforTimeout });
      disk = await read(browser);
      const latest = Math.max(...disk.records.map(r => r.sequence));
      await browser.execute(() => {
        document.querySelector('.runner-management').open = true;
        document.querySelector('.runner-management button').click();
      });
      await browser.waitUntil(async () => {
        disk = await read(browser);
        return disk.records.some(r => r.sequence > latest && r.operation === 'runner-restarted');
      }, { timeout: browser.options.waitforTimeout, timeoutMsg: 'No confirmed restart event while Single Entry remained open' });
      await browser.waitUntil(async () => browser.execute(() => {
        const n = document.querySelector('.hub-log-records');
        return !!document.querySelector('.single-entry.active') && n
          && n.scrollHeight - n.scrollTop - n.clientHeight <= 2;
      }), { timeout: browser.options.waitforTimeout });
      const appended = disk.records.find(r => r.sequence > latest && r.operation === 'runner-restarted');
      await browser.waitUntil(async () => browser.execute(sequence =>
        !!document.querySelector(`.hub-log-row[data-sequence="${sequence}"]`), appended.sequence),
      { timeout: browser.options.waitforTimeout });
      const liveAppend = { operation: 'runner-restarted', singleEntry: true, atBottomAfterAppend: true };
      await browser.execute(() => document.querySelector('.app-settings-trigger').click());
      await browser.execute(() => {
        const input = document.querySelector('.app-settings input[type="number"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '7');
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      await browser.waitUntil(async () => browser.execute(() => JSON.parse(localStorage.getItem(
        'agent-runner-hub.preferences.v1'))?.hubLogRetentionDays === 7), { timeout: browser.options.waitforTimeout });
      await browser.execute(() => document.querySelector('.settings-close').click());
      const lines = await browser.execute(() => [...document.querySelectorAll('.hub-log-row')].map(n => n.textContent));
      disk = await read(browser); assert.equal(disk.issue, null);
      assert.ok(lines.length > 0); assert.ok(disk.records.length >= lines.length);
      await stopWatching(browser);
      return { method: 'Candidate native Hub; actual Runner tab and app-local disk; no instruction submission', disk, lines, liveAppend };
    },
    async afterRestart(browser, before) {
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.app-settings[open]')),
        { timeout: browser.options.waitforTimeout });
      await browser.execute(() => document.querySelector('.single-entry').click());
      await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.hub-log-row').length > 0),
        { timeout: browser.options.waitforTimeout });
      let disk;
      await browser.waitUntil(async () => {
        disk = await read(browser);
        return disk.records.length > before.disk.records.length;
      }, { timeout: browser.options.waitforTimeout, timeoutMsg: 'Fresh startup events append after old history' });
      assert.equal(disk.issue, null);
      for (const old of before.disk.records) assert.deepEqual(disk.records.find(r => r.sequence === old.sequence), old);
      const lines = await browser.execute(() => [...document.querySelectorAll('.hub-log-row')].map(n => n.textContent));
      for (const old of before.lines) assert.ok(lines.includes(old), 'Restored formatter must be byte-identical');
      assert.equal(new Set(disk.records.map(r => r.sequence)).size, disk.records.length);
      assert.ok(disk.records.length > before.disk.records.length, 'Fresh startup events append after old history');
      const days = await browser.execute(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).hubLogRetentionDays);
      assert.equal(days, 7);
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
