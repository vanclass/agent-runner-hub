import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { isInspection } from './config-contract.mjs';
import { changeValue, readyInstalledHub, ownedConnection, testSelection, inspection,
  inspectRequest, receiptEvidence, stopWatching } from './runner-flow.mjs';

export function configurationSelection(runnerRoot) {
  return defineNativeCase({
    id: 'configuration-selection', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        const connection = await ownedConnection(browser);
        const selected = await testSelection(browser, connection, runnerRoot);
        const before = await inspection(browser, connection);
        const account = selected.result.reply.account;
        const accountSelector = '.context-settings .account-settings select';
        await browser.waitUntil(async () => browser.execute((selector, account) => {
          const select = document.querySelector(selector);
          return select && !select.disabled && [...select.options].some(o => o.value === JSON.stringify(account));
        }, accountSelector, account), { timeout: startupMs, timeoutMsg: 'Verified Test account absent from Hub catalog' });
        await changeValue(browser, accountSelector, JSON.stringify(account));
        await browser.waitUntil(async () => browser.execute(selector => !document.querySelector(selector).disabled,
          accountSelector), { timeout: startupMs });
        const catalog = await inspectRequest(browser, connection,
          { operation: 'session_config.inspect', api_version: 1, account, offset: 0 });
        assert.equal(catalog.result.state, 'accepted');
        assert.ok(isInspection(catalog.result.reply));
        assert.deepEqual(catalog.result.reply.model_options_account, account);
        if (catalog.result.reply.model_catalog_status !== 'available') throw new BlockedPrerequisite(
          'Test account model catalog unavailable; configure its saved authentication.');
        const uiModels = await browser.execute(() => [...document.querySelector(
          '.context-settings .model-settings select').options].filter(o => o.value && !o.disabled)
          .map(o => JSON.parse(o.value).model));
        for (const model of catalog.result.reply.options.models) assert.ok(uiModels.includes(model.id));
        const modeSelector = '.context-settings .execution-settings select';
        const mode = catalog.result.reply.options.run_modes.find(value => value === 'direct-run');
        if (!mode) throw new BlockedPrerequisite('Unsupported capability: direct-run selection absent from native catalog');
        await changeValue(browser, modeSelector, JSON.stringify(mode));
        const draft = await browser.execute(() => ({
          account: JSON.parse(document.querySelector('.context-settings .account-settings select').value),
          mode: JSON.parse(document.querySelector('.context-settings .execution-settings select').value),
          saved: JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry,
          instruction: document.querySelector('textarea[data-instruction]').value }));
        assert.deepEqual(draft.account, account);
        assert.deepEqual(draft.saved.accountIdentity, account);
        assert.equal(draft.mode, mode);
        assert.equal(draft.saved.runMode, mode);
        assert.equal(draft.instruction, '');
        const after = await inspection(browser, connection);
        assert.equal(after.result.reply.revision, before.result.reply.revision, 'Hub draft must not apply native configuration');
        return { method: 'actual Hub draft selection from authenticated Test-account catalog',
          identity: { session: connection.session, generation: connection.generation },
          testSelection: receiptEvidence(selected), catalog: receiptEvidence(catalog),
          uiCatalogAgreesWithNative: true, draftPersisted: true, nativeRevisionUnchanged: true,
          workAdmission: 'not exercised', workStart: 'not exercised' };
      } finally { await stopWatching(browser); }
    }
  });
}
