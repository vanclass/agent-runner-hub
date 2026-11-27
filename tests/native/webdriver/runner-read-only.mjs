import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, ownedConnection, inspection, receiptEvidence, stopWatching } from './runner-flow.mjs';
import { HubActions } from './hub-actions.mjs';

export function runnerReadOnly(runnerRoot) {
  return defineNativeCase({
    id: 'runner-read-only', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        const connection = await ownedConnection(browser, runnerRoot);
        const hub = new HubActions(browser);
        await hub.wait(async () => {
          const mode = await hub.field('mode');
          return mode?.disabled === false && mode.options.some(option => option.value && !option.disabled);
        }, 'Hub verified configuration selections not ready');
        // The app's startup inspection can retire earlier read receipts in the native result list.
        const before = await inspection(browser, connection);
        const ui = { account: (await hub.field('account')).value, model: (await hub.field('model')).value };
        const after = await inspection(browser, connection);
        assert.equal(before.result.reply.revision, after.result.reply.revision, 'Read-only inspection cannot mutate configuration');
        if (ui.account) {
          assert.deepEqual(ui.account, after.result.reply.current.account);
          assert.equal(ui.account.agent_id, after.result.reply.effective.agent_id);
        }
        if (ui.model) {
          assert.equal(ui.model.agent_id, after.result.reply.effective.agent_id);
          assert.equal(ui.model.model, after.result.reply.current.model.id);
          assert.equal(ui.model.reasoning_effort, after.result.reply.current.model.reasoning_effort);
          assert.equal(ui.model.service_tier, after.result.reply.current.service_tier);
        }
        const observed = await hub.observations.snapshot(connection);
        assert.deepEqual(observed.observation.selection, after.result.reply.effective);
        await browser.execute(id => window.__TAURI_INTERNALS__.invoke('pty_close', { id }), connection.session);
        await hub.wait(() => hub.observations.exited(connection.session), 'Closed Runner PTY was not removed', startupMs);
        return { method: 'actual Hub / authenticated native Runner; read-only',
          identity: { session: connection.session, generation: connection.generation },
          inspection: receiptEvidence(after), uiBound: { account: !!ui.account, model: !!ui.model },
          uiAgreesWithNative: true, revisionUnchanged: true, observationSerial: observed.observationSerial,
          ownedShutdown: { jobEmptied: true, ptyRemoved: true },
          workAdmission: 'not exercised', workStart: 'not exercised' };
      } finally { await stopWatching(browser); }
    }
  });
}
