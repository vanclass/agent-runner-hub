import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, visibleConnection, visibleConfiguration, stopWatching, changeValue } from './runner-flow.mjs';
import { semanticWork } from './semantic-work.mjs';
import { semanticError } from './semantic-error.mjs';

export function semanticPresentation(runnerRoot, workRoot, route = 'runner') {
  return defineNativeCase({
    id: workRoot ? (route === 'single-entry' ? 'single-entry-work' : 'semantic-work') : 'semantic-presentation', presentation: 'nonactivating',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      let stage = 'allocation';
      try {
        await browser.execute(() => document.querySelector('.add-runner').click());
        let connection = await visibleConnection(browser, runnerRoot);
        await browser.waitUntil(async () => browser.execute(() => {
          return document.querySelector('.semantic-logs')?.textContent.trim().length > 0;
        }), { timeout: startupMs, timeoutMsg: 'Actual semantic startup did not reach the viewport' });
        const startup = await browser.execute(() => {
          const output = document.querySelector('.semantic-logs');
          return { characters: output.textContent.length,
            records: output.querySelectorAll('.semantic-record').length,
            parserHidden: getComputedStyle(document.querySelector('.terminal-host')).visibility === 'hidden',
            incomplete: !!document.querySelector('.runner-semantic > .presentation-warning') };
        });
        assert.ok(startup.characters > 0); assert.ok(startup.parserHidden); assert.equal(startup.incomplete, false);
        // Use the ordinary Hub composer and authenticated command route, without PTY user input.
        const canonical = await visibleConfiguration(browser, connection);
        stage = 'canonical-account-catalog';
        const account = JSON.stringify(canonical.current.account);
        await browser.waitUntil(async () => browser.execute(account => {
          const select = document.querySelector('.task-panel .account-settings select');
          return select && !select.disabled && [...select.options].some(option => option.value === account);
        }, account), { timeout: startupMs, timeoutMsg: 'Canonical startup account unavailable in Hub catalog' });
        await changeValue(browser, '.task-panel .account-settings select', account);
        stage = 'model-catalog';
        await browser.waitUntil(async () => browser.execute(() => {
          const model = document.querySelector('.task-panel .model-settings select');
          return model && !model.disabled && model.options.length > 1;
        }), { timeout: startupMs, timeoutMsg: 'Runner tab configuration catalog did not become ready' });
        stage = 'composer-readiness';
        await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-composer textarea')?.disabled), { timeout: startupMs });
        if (workRoot) {
          stage = 'work-' + route;
          const workAdmission = await semanticWork(browser, connection, workRoot, route);
          return { method: 'actual installed Runner / native Hub / canonical presentation', startup,
            workAdmission, identity: workAdmission.identity,
            allocationIdentity: { tab: connection.tab, session: connection.session, generation: connection.generation } };
        }
        stage = 'command-submission';
        await browser.execute(() => {
          const input = document.querySelector('.runner-composer textarea');
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '/help');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await browser.execute(() => {
          const input = document.querySelector('.runner-composer textarea');
          input.focus();
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        });
        let commandObservation;
        await browser.waitUntil(async () => {
          const observations = await browser.execute(async () => Promise.all(Object.keys(window.__wg3Observation.snapshots)
            .map(async session => ({ session, snapshot: await window.__TAURI_INTERNALS__.invoke('runner_observe', { id: session }) }))));
          const matches = observations.filter(item => item.snapshot.results.some(r => r.command === '/help'
            && r.phase === 'completed' && r.state === 'accepted'));
          assert.ok(matches.length <= 1, 'One composer submission must identify exactly one owning native session');
          commandObservation = matches[0];
          return !!commandObservation;
        }, { timeout: startupMs, timeoutMsg: 'Actual composer command did not complete' }).catch(async error => {
          const diagnostic = await browser.execute(async () => ({
            input: (() => { const input = document.querySelector('.runner-composer textarea'); return {
              present: !!input, focused: input === document.activeElement, disabled: input?.disabled,
              expectedDraft: input?.value === '/help', modal: !!document.querySelector('dialog[open]') }; })(),
            sessions: await Promise.all(Object.keys(window.__wg3Observation.snapshots).map(async id => {
              const snapshot = await window.__TAURI_INTERNALS__.invoke('runner_observe', { id });
              return { id, state: snapshot.state, commands: snapshot.results.map(r => ({ command: r.command,
                state: r.state, phase: r.phase, code: r.code })) };
            })) }));
          throw new Error(error.message + ': ' + JSON.stringify(diagnostic));
        });
        // Allocation may create a fresh session instead of promoting the original spare.
        // Correlate the actual composer receipt, never assume spare-to-tab identity.
        assert.equal(commandObservation.session, connection.session, 'Visible tab owns the command receipt');
        assert.equal(commandObservation.snapshot.features.generation, connection.generation);
        stage = 'command-output';
        await browser.waitUntil(async () => browser.execute(count => document.querySelectorAll('.semantic-record').length > count,
          startup.records), { timeout: startupMs, timeoutMsg: 'Help produced no new canonical records' });
        const helpOutput = await browser.execute(count => [...document.querySelectorAll('.semantic-record')]
          .slice(count).map(n => n.textContent).join('').slice(0, 6000), startup.records);
        assert.ok(helpOutput.trim().length > 0, 'Completed /help must add canonical output');
        const error = await semanticError(browser, connection);
        return { method: 'actual installed Runner / native Hub / canonical presentation', startup,
          composerCommand: '/help', commandCompleted: true, semanticOutputObserved: true,
          helpOutput,
          workAdmission: 'not exercised by read-only command case',
          errorPresentation: error ?? 'not exercised by work case',
          identity: { tab: connection.tab, session: connection.session, generation: connection.generation } };
      } catch (error) {
        const diagnostic = await browser.execute(() => {
          const host = document.querySelector('.terminal-host');
          let fiber = host?.[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
          for (; fiber; fiber = fiber.return) {
            const s = fiber.memoizedProps?.session;
            if (s?.terminal?.element?.parentElement !== host) continue;
            return { tab: s.view.id, session: s.control.sessionId, status: s.view.status,
              canSubmit: s.view.canSubmit, win32: s.input.win32, modes: s.terminal.modes,
              reserved: s.assignmentReserved, foreground: s.foregroundInteraction,
              uncertain: s.submissionUncertain, state: s.control.snapshot.state,
              generation: s.control.snapshot.features?.generation,
              presentation: { mode: s.control.presentation.state.mode, cursor: s.control.presentation.state.cursor,
                records: s.control.presentation.state.records.length, issues: [...s.control.presentation.state.issues],
                tail: s.control.presentation.state.records.slice(-4).map(r => r.text).join('').slice(-3000) },
              attention: s.control.snapshot.observation?.attention,
              composerDisabled: document.querySelector('.runner-composer textarea')?.disabled };
          }
          return { activeTab: document.querySelector('.runner-row.active')?.dataset.runnerId };
        });
        error.message += ': ' + JSON.stringify({ stage, diagnostic });
        throw error;
      } finally { await stopWatching(browser); }
    },
    async observe(browser) {
      await browser.execute(() => {
        const toggle = document.querySelector('.task-panel-toggle');
        if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
      });
      const observation = await browser.execute(() => {
        const viewport = document.querySelector('.runner-semantic'), rect = viewport.getBoundingClientRect();
        const input = document.querySelector('.runner-composer textarea'), composer = input.getBoundingClientRect();
        return { width: rect.width, height: rect.height, visible: getComputedStyle(viewport).visibility,
          composerHeight: composer.height, composerBelowTerminal: composer.top >= rect.bottom,
          parserHidden: getComputedStyle(document.querySelector('.terminal-host')).visibility === 'hidden' };
      });
      assert.ok(observation.width > 0 && observation.height > 100);
      assert.equal(observation.visible, 'visible'); assert.ok(observation.parserHidden && observation.composerBelowTerminal);
      return observation;
    }
  });
}
