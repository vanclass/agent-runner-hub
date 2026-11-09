import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, ownedConnection, testSelection, inspection, receiptEvidence, stopWatching, correlated } from './runner-flow.mjs';

export function runnerReadOnly(runnerRoot) {
  return defineNativeCase({
    id: 'runner-read-only', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        const connection = await ownedConnection(browser);
        const selected = await testSelection(browser, connection, runnerRoot);
        const before = await inspection(browser, connection);
        await browser.waitUntil(async () => browser.execute(() => {
          const account = document.querySelector('.context-settings .account-settings select');
          const model = document.querySelector('.context-settings .model-settings select');
          return account && model && !account.disabled && !!account.value && !!model.value;
        }), { timeout: startupMs, timeoutMsg: 'Hub verified configuration selections not ready' });
        const ui = await browser.execute(() => ({
          account: JSON.parse(document.querySelector('.context-settings .account-settings select').value),
          model: JSON.parse(document.querySelector('.context-settings .model-settings select').value) }));
        const after = await inspection(browser, connection);
        assert.equal(before.result.reply.revision, after.result.reply.revision, 'Read-only inspection cannot mutate configuration');
        assert.deepEqual(ui.account, after.result.reply.current.account);
        assert.equal(ui.model.model, after.result.reply.current.model.id);
        assert.equal(ui.model.reasoning_effort, after.result.reply.current.model.reasoning_effort);
        assert.equal(ui.model.service_tier, after.result.reply.current.service_tier);
        const observed = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke(
          'runner_observe', { id }), connection.session), connection);
        assert.equal(observed.observation.selection.account, ui.account.profile_name);
        assert.equal(observed.observation.selection.model, ui.model.model);
        assert.equal(observed.observation.selection.reasoning_effort, ui.model.reasoning_effort);
        assert.equal(observed.observation.selection.service_tier, ui.model.service_tier);
        return { method: 'actual Hub / authenticated native Runner; read-only',
          identity: { session: connection.session, generation: connection.generation },
          testAccount: { verified: true, authentication: selected.result.reply.authentication },
          testSelection: receiptEvidence(selected), inspection: receiptEvidence(after),
          uiAgreesWithNative: true, revisionUnchanged: true, observationSerial: observed.observationSerial,
          workAdmission: 'not exercised', workStart: 'not exercised' };
      } finally { await stopWatching(browser); }
    }
  });
}
