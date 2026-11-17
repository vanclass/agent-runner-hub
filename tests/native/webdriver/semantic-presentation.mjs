import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, ownedConnection, stopWatching, inspection, changeValue } from './runner-flow.mjs';
import { semanticWork } from './semantic-work.mjs';
import { semanticError } from './semantic-error.mjs';

export function semanticPresentation(runnerRoot, workRoot) {
  return defineNativeCase({
    id: workRoot ? 'semantic-work' : 'semantic-presentation', presentation: 'nonactivating',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        let connection = await ownedConnection(browser, runnerRoot);
        await browser.execute(() => document.querySelector('.add-runner').click());
        await browser.waitUntil(async () => browser.execute(() => {
          return document.querySelector('.xterm-rows')?.textContent.trim().length > 0;
        }), { timeout: startupMs, timeoutMsg: 'Actual PTY startup did not reach the viewport' });
        const startup = await browser.execute(() => {
          const output = document.querySelector('.xterm-rows');
          return { characters: output.textContent.length,
            parserVisible: getComputedStyle(document.querySelector('.terminal-host')).visibility === 'visible' };
        });
        assert.ok(startup.characters > 0); assert.ok(startup.parserVisible);
        // Use the ordinary Hub composer and authenticated command route, without PTY user input.
        const canonical = await inspection(browser, connection);
        const account = JSON.stringify(canonical.result.reply.current.account);
        await browser.waitUntil(async () => browser.execute(account => {
          const select = document.querySelector('.task-panel .account-settings select');
          return select && !select.disabled && [...select.options].some(option => option.value === account);
        }, account), { timeout: startupMs, timeoutMsg: 'Canonical startup account unavailable in Hub catalog' });
        await changeValue(browser, '.task-panel .account-settings select', account);
        await browser.waitUntil(async () => browser.execute(() => {
          const model = document.querySelector('.task-panel .model-settings select');
          return model && !model.disabled && model.options.length > 1;
        }), { timeout: startupMs, timeoutMsg: 'Runner tab configuration catalog did not become ready' });
        await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-composer textarea')?.disabled), { timeout: startupMs });
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
        connection = { ...commandObservation, generation: commandObservation.snapshot.features.generation };
        await browser.waitUntil(async () => browser.execute(() => /help/i.test(document.querySelector('.xterm-rows')?.textContent)), { timeout: startupMs });
        const work = workRoot ? await semanticWork(browser, connection, workRoot) : undefined;
        const error = workRoot ? undefined : await semanticError(browser, connection);
        return { method: 'actual installed Runner / native Hub / original PTY output', startup,
          composerCommand: '/help', commandCompleted: true, ptyOutputObserved: true,
          workAdmission: work ?? 'not exercised by read-only command case',
          errorPresentation: error ?? 'not exercised by work case',
          identity: { session: connection.session, generation: connection.generation } };
      } finally { await stopWatching(browser); }
    },
    async observe(browser) {
      const observation = await browser.execute(() => {
        const viewport = document.querySelector('.terminal-host'), rect = viewport.getBoundingClientRect();
        const input = document.querySelector('.runner-composer textarea'), composer = input.getBoundingClientRect();
        return { width: rect.width, height: rect.height, visible: getComputedStyle(viewport).visibility,
          composerHeight: composer.height, composerBelowTerminal: composer.top >= rect.bottom,
          semanticViewportAbsent: !document.querySelector('.runner-semantic') };
      });
      assert.ok(observation.width > 0 && observation.height > 100);
      assert.equal(observation.visible, 'visible'); assert.ok(observation.semanticViewportAbsent && observation.composerBelowTerminal);
      return observation;
    }
  });
}
