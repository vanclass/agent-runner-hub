import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, visibleConnection } from './runner-flow.mjs';
import { HubActions } from './hub-actions.mjs';

export function terminalCommands(runnerRoot, displayed = false) {
  return defineNativeCase({
    id: displayed ? 'semantic-presentation' : 'terminal-commands',
    presentation: displayed ? 'nonactivating' : 'background', ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      const hub = new HubActions(browser);
      const { terminal } = hub;
      const tab = await hub.addRunner();
      const connection = await visibleConnection(browser, runnerRoot);
      const startup = await terminal.buffer();
      assert.ok(startup.visible.split('\n').some(line => line.trim()), 'Runner startup output missing');
      assert.ok(startup.visible.split('\n').slice(-4).every(line => !line.trim()),
        'The idle PTY still shows composer or Context Footer rows');
      async function command(text) {
        await hub.draft('runner', text);
        await hub.wait(async () => {
          const state = await hub.observations.active();
          return state?.activity === 'idle' && state.fresh && !state.controlBusy;
        }, 'Owned Runner command control did not become ready for ' + text);
        const previousId = (await hub.observations.snapshot(connection)).results.at(-1)?.id ?? 0;
        await hub.submit('runner');
        let receipt, result;
        await browser.waitUntil(async () => {
          const snapshot = await hub.observations.snapshot(connection);
          result = snapshot.results.find(r => r.id > previousId && r.command === text);
          receipt = result?.phase === 'completed' ? result : null;
          assert.notEqual(result?.state, 'outcome-unknown', 'Command effect unknown; do not replay: ' + text);
          return !!receipt;
        }, { timeout: startupMs, timeoutMsg: 'Command receipt missing; do not replay: ' + text }).catch(async error => {
          const { records } = await hub.logs.history();
          error.message += ' ' + JSON.stringify({ state: result?.state,
            recentEvents: records.slice(-5).map(({ operation, actual, code }) => ({ operation, actual, code })) });
          throw error;
        });
        return receipt;
      }
      const helpReceipt = await command('/help');
      assert.equal(helpReceipt.state, 'accepted');
      await hub.wait(async () => await terminal.find('/troubleshoot') >= 0, 'Help output missing');
      const publication = await terminal.buffer(), canonical = await terminal.canonicalRecords(connection);
      assert.ok(canonical.text.includes('/troubleshoot'));
      const normalize = text => text.replace(/\s/g, '');
      assert.ok(normalize(publication.full).includes(normalize(canonical.text)), 'Canonical durable output is physically present in full xterm buffer');
      const errorReceipt = await command('/files __hub_invalid_argument__');
      assert.ok(['rejected', 'failure'].includes(errorReceipt.state), JSON.stringify(errorReceipt));
      assert.match(errorReceipt.code ?? '', /^(RUNNER_COMMAND_USAGE_INVALID|UNKNOWN_SLASH_BLOCKED_BY_STATE)$/);
      await hub.wait(async () => normalize((await terminal.buffer()).full).includes(errorReceipt.code),
        'Correlated rejection code missing from terminal output: ' + errorReceipt.code);
      const after = await terminal.buffer();
      assert.ok(after.full.includes('/troubleshoot'), 'Help remains after subsequent error output');
      assert.ok(normalize(after.full).includes(errorReceipt.code));
      const scroll = await hub.terminal.scroll('top');
      assert.equal(scroll.viewportY, 0); assert.ok(scroll.baseY > 0);
      const editors = [];
      for (const single of displayed ? [false, true] : []) {
        if (single) await hub.selectSingleEntry();
        const surface = single ? 'single-entry' : 'runner';
        await hub.draft(surface, 'native viewport line\n'.repeat(120));
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
        await hub.draft(surface, '');
      }
      await hub.selectRunner(tab);
      return { connection, startup, idleChromeRows: 0, helpReceipt, publication, canonical, errorReceipt, after, scroll, editors };
    },
    async observe(browser) {
      const { settings, terminal } = new HubActions(browser);
      const colors = () => browser.execute(() => {
        const host = document.querySelector('.terminal-host');
        const background = selector => getComputedStyle(host.querySelector(selector)).backgroundColor;
        return { app: document.querySelector('.hub').dataset.theme,
          viewport: background('.xterm-viewport'), rows: background('.xterm-scrollable-element') };
      });
      const light = await colors();
      assert.deepEqual(light, { app: 'light', viewport: 'rgb(255, 255, 255)', rows: 'rgb(255, 255, 255)' });
      const before = await terminal.buffer();
      const rejection = /RUNNER_COMMAND_USAGE_INVALID|UNKNOWN_SLASH_BLOCKED_BY_STATE/.exec(before.full);
      assert.ok(rejection, 'The earlier command rejection is present before the theme change');
      const durableEnd = before.full.indexOf('\n', rejection.index);
      assert.ok(durableEnd > 0);
      await settings.edit('terminalTheme', 'dark');
      const dark = await colors();
      assert.deepEqual(dark, { app: 'light', viewport: 'rgb(17, 18, 20)', rows: 'rgb(17, 18, 20)' });
      assert.ok((await terminal.buffer()).full.startsWith(before.full.slice(0, durableEnd)),
        'Earlier command output remains intact across a theme change');
      await settings.edit('terminalTheme', 'follow');
      assert.deepEqual(await colors(), light);
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
      return { ...observation, light, dark };
    }
  });
}
