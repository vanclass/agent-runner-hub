import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, ownedConnection, inspection, receiptEvidence, stopWatching, correlated } from './runner-flow.mjs';

export function runnerReadOnly(runnerRoot) {
  return defineNativeCase({
    id: 'runner-read-only', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        const connection = await ownedConnection(browser, runnerRoot);
        const before = await inspection(browser, connection);
        await browser.waitUntil(async () => browser.execute(() => {
          const account = document.querySelector('.context-settings .account-settings select');
          const model = document.querySelector('.context-settings .model-settings select');
          return account && model && !account.disabled && !model.disabled;
        }), { timeout: startupMs, timeoutMsg: 'Hub verified configuration selections not ready' });
        const ui = await browser.execute(() => ({
          account: JSON.parse(document.querySelector('.context-settings .account-settings select').value || 'null'),
          model: JSON.parse(document.querySelector('.context-settings .model-settings select').value || 'null') }));
        const after = await inspection(browser, connection);
        assert.equal(before.result.reply.revision, after.result.reply.revision, 'Read-only inspection cannot mutate configuration');
        if (ui.account) assert.deepEqual(ui.account, after.result.reply.current.account);
        if (ui.model) {
          assert.equal(ui.model.model, after.result.reply.current.model.id);
          assert.equal(ui.model.reasoning_effort, after.result.reply.current.model.reasoning_effort);
          assert.equal(ui.model.service_tier, after.result.reply.current.service_tier);
        }
        const observed = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke(
          'runner_observe', { id }), connection.session), connection);
        assert.deepEqual(observed.observation.selection, after.result.reply.effective);
        return { method: 'actual Hub / authenticated native Runner; read-only',
          identity: { session: connection.session, generation: connection.generation },
          inspection: receiptEvidence(after), uiBound: { account: !!ui.account, model: !!ui.model },
          uiAgreesWithNative: true, revisionUnchanged: true, observationSerial: observed.observationSerial,
          workAdmission: 'not exercised', workStart: 'not exercised' };
      } finally { await stopWatching(browser); }
    }
  });
}
