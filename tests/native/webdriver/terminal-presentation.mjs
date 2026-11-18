import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, visibleConnection, visibleConfiguration, changeValue, correlated } from './runner-flow.mjs';
import { semanticWork } from './semantic-work.mjs';
import { terminalBuffer, canonicalRecords } from './terminal-buffer.mjs';

export function semanticPresentation(runnerRoot, workRoot, route = 'runner') {
  return defineNativeCase({
    id: workRoot ? (route === 'single-entry' ? 'single-entry-work' : 'semantic-work') : 'semantic-presentation',
    presentation: 'nonactivating', ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      await browser.execute(() => document.querySelector('.add-runner').click());
      const connection = await visibleConnection(browser, runnerRoot);
      const configuration = await visibleConfiguration(browser, connection);
      const account = JSON.stringify(configuration.current.account);
      await browser.waitUntil(async () => browser.execute(account => {
        const select = document.querySelector('.task-panel .account-settings select');
        return select && !select.disabled && [...select.options].some(option => option.value === account);
      }, account), { timeout: startupMs });
      await changeValue(browser, '.task-panel .account-settings select', account);
      await browser.waitUntil(async () => browser.execute(() => {
        const select = document.querySelector('.task-panel .model-settings select');
        return select && !select.disabled && select.options.length > 1;
      }), { timeout: startupMs });
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-composer textarea')?.disabled), { timeout: startupMs });
      const startup = await terminalBuffer(browser);
      if (workRoot) return { startup, workAdmission: await semanticWork(browser, connection, workRoot, route) };
      async function command(text) {
        await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-composer textarea')?.disabled), { timeout: startupMs });
        await changeValue(browser, '.runner-composer textarea', text);
        await browser.execute(() => {
          const input = document.querySelector('.runner-composer textarea');
          input.focus();
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        });
        let receipt;
        await browser.waitUntil(async () => {
          const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
          receipt = snapshot.results.find(r => r.command === text && r.phase === 'completed');
          return !!receipt;
        }, { timeout: startupMs, timeoutMsg: 'Command receipt missing; do not replay' });
        assert.notEqual(receipt.state, 'outcome-unknown');
        return receipt;
      }
      const helpReceipt = await command('/help');
      await browser.waitUntil(async () => (await terminalBuffer(browser)).full.includes('/troubleshoot'), { timeout: startupMs });
      const publication = await terminalBuffer(browser), canonical = await canonicalRecords(browser, connection);
      assert.ok(canonical.text.includes('/troubleshoot'));
      const normalize = text => text.replace(/\s/g, '');
      assert.ok(normalize(publication.full).includes(normalize(canonical.text)), 'Canonical durable output is physically present in full xterm buffer');
      const errorReceipt = await command('/files __hub_invalid_argument__');
      await browser.waitUntil(async () => (await terminalBuffer(browser)).full.includes('UNKNOWN_SLASH_BLOCKED_BY_STATE'), { timeout: startupMs });
      const after = await terminalBuffer(browser);
      assert.ok(after.full.includes('/troubleshoot'), 'Help remains after subsequent error output');
      assert.ok(after.full.includes('UNKNOWN_SLASH_BLOCKED_BY_STATE'));
      const scroll = await browser.execute(() => {
        const host = document.querySelector('.terminal-host');
        let fiber = host[Object.keys(host).find(k => k.startsWith('__reactFiber$'))];
        for (; fiber; fiber = fiber.return) {
          const s = fiber.memoizedProps?.session;
          if (s?.terminal?.element?.parentElement !== host) continue;
          s.terminal.scrollToTop(); return { top: s.terminal.buffer.active.viewportY, base: s.terminal.buffer.active.baseY };
        }
      });
      assert.equal(scroll.top, 0); assert.ok(scroll.base > 0);
      const editors = [];
      for (const single of [false, true]) {
        if (single) await browser.execute(() => document.querySelector('.single-entry').click());
        await browser.waitUntil(async () => browser.execute(() => {
          const input = document.querySelector('textarea[data-instruction]');
          return input && !input.disabled && !input.readOnly;
        }), { timeout: startupMs });
        await changeValue(browser, 'textarea[data-instruction]', 'native viewport line\n'.repeat(120));
        editors.push(await browser.execute(() => {
          const input = document.querySelector('textarea[data-instruction]');
          input.scrollTop = 240;
          const rect = s => { const r = document.querySelector(s).getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height }; };
          return { output: rect('.output'), composer: rect('.composer-area'), footer: rect('.hub-activity'),
            scroll: input.scrollTop, overflow: input.scrollHeight > input.clientHeight };
        }));
        const last = editors.at(-1);
        assert.ok(last.overflow && last.scroll >= 200);
        assert.ok(last.output.height >= 45 && last.output.bottom <= last.composer.top + 1);
        assert.ok(last.composer.bottom <= last.footer.top + 1);
        await changeValue(browser, 'textarea[data-instruction]', '');
      }
      await browser.execute(() => document.querySelector('.runner-row .nav-row').click());
      return { connection, startup, helpReceipt, publication, canonical, errorReceipt, after, scroll, editors };
    },
    async observe(browser) {
      const observation = await browser.execute(() => {
        const terminal = document.querySelector('.terminal-host'), rect = terminal.getBoundingClientRect();
        const input = document.querySelector('.runner-composer textarea'), composer = input.getBoundingClientRect();
        return { width: rect.width, height: rect.height, visibility: getComputedStyle(terminal).visibility,
          composerHeight: composer.height, composerBelowTerminal: composer.top >= rect.bottom,
          semanticRenderers: document.querySelectorAll('.runner-semantic').length };
      });
      assert.ok(observation.width > 0 && observation.height > 100);
      assert.equal(observation.visibility, 'visible'); assert.ok(observation.composerBelowTerminal);
      assert.equal(observation.semanticRenderers, 0);
      return observation;
    }
  });
}
