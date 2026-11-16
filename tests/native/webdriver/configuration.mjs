import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { isInspection } from './config-contract.mjs';
import { changeValue, readyInstalledHub, ownedConnection, inspection,
  inspectRequest, receiptEvidence, stopWatching } from './runner-flow.mjs';

export function configurationSelection(runnerRoot) {
  return defineNativeCase({
    id: 'configuration-selection', presentation: 'nonactivating',
    async observe(browser) {
      const instructionFocus = [];
      for (const selector of ['.sidebar .nav-row', '.runner-row .nav-row']) {
        await browser.execute(selector => document.querySelector(selector).click(), selector);
        const focus = await browser.execute(() => {
          const input = document.querySelector('textarea[data-instruction]');
          input.focus();
          return { surface: input.getAttribute('aria-label'), focused: input === document.activeElement,
            outline: getComputedStyle(input).outlineStyle, disabled: input.disabled,
            visible: input.getBoundingClientRect().height > 0 && document.visibilityState === 'visible' };
        });
        assert.equal(focus.focused, true); assert.equal(focus.outline, 'none');
        assert.equal(focus.disabled, false); assert.equal(focus.visible, true);
        instructionFocus.push(focus);
      }
      const activity = await browser.execute(() => {
        const line = document.querySelector('.hub-activity');
        return { height: line.getBoundingClientRect().height, wrap: getComputedStyle(line).whiteSpace,
          belowComposer: Math.abs(line.getBoundingClientRect().top - line.previousElementSibling.getBoundingClientRect().bottom) < 1,
          settingsOpen: !!document.querySelector('.app-settings[open]'),
          detailedPanels: document.querySelectorAll('.config-evidence, .config-plan, .config-receipt').length };
      });
      assert.deepEqual(activity, { height: 22, wrap: 'nowrap', belowComposer: true, settingsOpen: false, detailedPanels: 0 });
      return { ...activity, instructionFocus };
    },
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        const connection = await ownedConnection(browser, runnerRoot);
        const before = await inspection(browser, connection);
        const account = before.result.reply.options.accounts.find(value =>
          JSON.stringify(value) === JSON.stringify(before.result.reply.current.account));
        if (!account || !before.result.reply.availability.account) throw new BlockedPrerequisite(
          'Ordinary startup account is unavailable in the authenticated catalog.');
        const accountSelector = '.task-panel .account-settings select';
        await browser.waitUntil(async () => browser.execute((selector, account) => {
          const select = document.querySelector(selector);
          return select && !select.disabled && [...select.options].some(o => o.value === JSON.stringify(account));
        }, accountSelector, account), { timeout: startupMs, timeoutMsg: 'Verified startup account absent from Hub catalog' });
        await changeValue(browser, accountSelector, JSON.stringify(account));
        await browser.waitUntil(async () => browser.execute(selector => !document.querySelector(selector).disabled,
          accountSelector), { timeout: startupMs });
        const catalog = await inspectRequest(browser, connection,
          { operation: 'session_config.inspect', api_version: 1, account, offset: 0 });
        assert.equal(catalog.result.state, 'accepted');
        assert.ok(isInspection(catalog.result.reply));
        assert.deepEqual(catalog.result.reply.model_options_account, account);
        if (catalog.result.reply.model_catalog_status !== 'available') throw new BlockedPrerequisite(
          'Ordinary startup account model catalog unavailable: ' + catalog.result.reply.model_catalog_status);
        const uiModels = await browser.execute(() => [...document.querySelector(
          '.task-panel .model-settings select').options].filter(o => o.value && !o.disabled)
          .map(o => JSON.parse(o.value).model));
        for (const model of catalog.result.reply.options.models) assert.ok(uiModels.includes(model.id));
        const modelSelector = '.task-panel .model-settings select';
        const candidate = await browser.execute(selector => [...document.querySelector(selector).options]
          .find(option => option.value && !option.disabled)?.value, modelSelector);
        if (!candidate) throw new BlockedPrerequisite('No selectable authenticated model candidate');
        const model = JSON.parse(candidate);
        assert.ok(catalog.result.reply.options.models.some(value => value.id === model.model
          && value.reasoning_efforts.includes(model.reasoning_effort) && value.service_tiers.includes(model.service_tier)));
        await changeValue(browser, modelSelector, candidate);
        const modeSelector = '.task-panel .execution-settings select';
        const mode = catalog.result.reply.options.run_modes[0];
        if (!mode) throw new BlockedPrerequisite('No available run-mode candidate in native catalog');
        await changeValue(browser, modeSelector, JSON.stringify(mode));
        const draft = await browser.execute(() => ({
          account: JSON.parse(document.querySelector('.task-panel .account-settings select').value),
          mode: JSON.parse(document.querySelector('.task-panel .execution-settings select').value),
          saved: JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry,
          instruction: document.querySelector('textarea[data-instruction]').value }));
        assert.deepEqual(draft.account, account);
        assert.deepEqual(draft.saved.accountIdentity, account);
        assert.equal(draft.mode, mode);
        assert.equal(draft.saved.runMode, mode);
        assert.deepEqual(draft.saved.model, model);
        assert.equal(draft.instruction, '');
        const instructionFocus = [];
        for (const surface of ['Single Entry', 'Runner']) {
          if (surface === 'Runner') {
            await browser.execute(() => document.querySelector('.add-runner').click());
            await browser.waitUntil(async () => browser.execute(() =>
              !!document.querySelector('.runner-composer textarea[data-instruction]')), { timeout: startupMs });
          }
          const focus = await browser.execute(() => {
            const input = document.querySelector('textarea[data-instruction]');
            input.focus();
            const style = getComputedStyle(input), rect = input.getBoundingClientRect();
            return { focused: input === document.activeElement, outline: style.outlineStyle,
              width: rect.width, height: rect.height, disabled: input.disabled };
          });
          assert.equal(focus.focused, true); assert.equal(focus.outline, 'none');
          assert.ok(focus.width > 0 && focus.height > 0); assert.equal(focus.disabled, false);
          instructionFocus.push({ surface, ...focus });
        }
        const after = await inspection(browser, connection);
        assert.equal(after.result.reply.revision, before.result.reply.revision, 'Hub draft must not apply native configuration');
        return { method: 'actual Hub draft selection from ordinary authenticated catalog',
          identity: { session: connection.session, generation: connection.generation },
          initialInspection: receiptEvidence(before), catalog: receiptEvidence(catalog),
          uiCatalogAgreesWithNative: true, draftPersisted: true, nativeRevisionUnchanged: true, instructionFocus,
          workAdmission: 'not exercised', workStart: 'not exercised' };
      } finally { await stopWatching(browser); }
    }
  });
}
