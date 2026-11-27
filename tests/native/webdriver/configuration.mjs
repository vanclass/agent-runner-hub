import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';
import { isInspection } from './config-contract.mjs';
import { HubActions } from './hub-actions.mjs';
import { readyInstalledHub, ownedConnection, inspection,
  inspectRequest, receiptEvidence, stopWatching } from './runner-flow.mjs';

export function configurationPresentation(runnerRoot) {
  return defineNativeCase({
    id: 'configuration-presentation', presentation: 'nonactivating',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      await ownedConnection(browser, runnerRoot);
      const hub = new HubActions(browser);
      return { tab: await hub.addRunner() };
    },
    async observe(browser) {
      const hub = new HubActions(browser);
      const id = await hub.activeRunner();
      const instructionFocus = [];
      for (const surface of ['single-entry', 'runner']) {
        if (surface === 'single-entry') await hub.selectSingleEntry();
        else await hub.selectRunner(id);
        await hub.wait(async () => (await hub.instructionState(surface))?.disabled === false,
          'Displayed editor unavailable: ' + surface);
        const focus = await browser.execute(() => {
          const input = document.querySelector('textarea[data-instruction]');
          input.focus();
          const rect = input.getBoundingClientRect();
          return { surface: input.getAttribute('aria-label'), focused: input === document.activeElement,
            outline: getComputedStyle(input).outlineStyle, disabled: input.disabled,
            visible: rect.height > 0 && rect.width > 0 && document.visibilityState === 'visible' };
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
    }
  });
}

export function configurationSelection(runnerRoot, directRoot) {
  return defineNativeCase({
    id: 'configuration-selection', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      const hub = new HubActions(browser);
      try {
        const connection = await ownedConnection(browser, runnerRoot);
        const before = await inspection(browser, connection);
        const provider = before.result.reply.effective.agent_id;
        const providerLabel = id => ({ codex: 'Codex', claude: 'Claude', none: 'None' })[id] ?? 'Unavailable';
        const account = before.result.reply.options.accounts.find(value => value.agent_id === provider
          && JSON.stringify(value) === JSON.stringify(before.result.reply.current.account));
        if (!account || !before.result.reply.availability.account) throw new BlockedPrerequisite(
          'The effective Provider has no current account available in the authenticated catalog.');
        await hub.selectProviderAccount(provider, account);
        await hub.wait(async () => (await hub.field('account'))?.disabled === false,
          'Hub account catalog did not settle');
        const providers = (await hub.field('account')).options
          .filter(option => option.value && !option.disabled).map(option => option.value.agent_id);
        assert.ok(providers.every(id => id === provider));
        const catalog = await inspectRequest(browser, connection,
          { operation: 'session_config.inspect', api_version: 1, account, offset: 0 });
        assert.equal(catalog.result.state, 'accepted');
        assert.ok(isInspection(catalog.result.reply));
        assert.deepEqual(catalog.result.reply.model_options_account, account);
        if (catalog.result.reply.model_catalog_status !== 'available') throw new BlockedPrerequisite(
          'Ordinary startup account model catalog unavailable: ' + catalog.result.reply.model_catalog_status);
        let models;
        await hub.wait(async () => {
          const field = await hub.field('model');
          if (!field || field.disabled) return false;
          models = field.options.filter(option => option.value && !option.disabled).map(option => option.value);
          return models.length > 0;
        }, 'Hub model catalog did not settle after account selection');
        const uiModels = models.map(model => model.model);
        for (const model of catalog.result.reply.options.models) assert.ok(uiModels.includes(model.id));
        const compatible = models.filter(choice => catalog.result.reply.options.models.some(value => value.id === choice.model
          && value.reasoning_efforts.includes(choice.reasoning_effort) && value.service_tiers.includes(choice.service_tier)));
        const currentModel = (await hub.field('model')).value;
        const model = compatible.find(choice => choice.model !== currentModel?.model) ?? compatible[0];
        if (!model) throw new BlockedPrerequisite('No compatible authenticated model candidate');
        assert.equal(model.agent_id, provider);
        await hub.edit('model', model);
        assert.deepEqual((await hub.field('model')).value, model);
        const reasoning = (await hub.field('reasoning')).options.find(option => !option.disabled && option.value !== model.reasoning_effort);
        if (reasoning) await hub.edit('reasoning', reasoning.value);
        const fast = await hub.field('fast');
        if (!fast.disabled) await hub.edit('fast', !fast.value);
        const requestedModel = (await hub.field('model')).value;
        if (reasoning) assert.equal(requestedModel.reasoning_effort, reasoning.value);
        if (!fast.disabled) assert.equal(requestedModel.service_tier, fast.value ? 'default' : 'fast');
        const modeField = await hub.field('mode');
        const modes = modeField.options.filter(option => option.value && !option.disabled).map(option => option.value);
        const targetModes = modes.filter(value => !['direct-run', 'pure-direct-run'].includes(value));
        const mode = targetModes.find(value => value !== modeField.value) ?? targetModes[0] ?? modes[0];
        if (!mode) throw new BlockedPrerequisite('No available run-mode candidate in native catalog');
        await hub.edit('mode', mode);
        const target = (await hub.field('target'))?.options.find(option => !option.disabled && option.value)?.value;
        if (target) {
          await hub.edit('target', target);
          assert.deepEqual((await hub.field('target')).value, target);
        }
        const saved = (await hub.settings.saved()).singleEntry;
        assert.deepEqual((await hub.field('account')).value, account);
        assert.deepEqual(saved.accountIdentity, account);
        assert.equal((await hub.field('mode')).value, mode);
        assert.equal(saved.runMode, mode);
        assert.deepEqual(saved.model, requestedModel);
        assert.equal((await hub.instructionState('single-entry')).value, '');
        const directMode = modes.find(value => ['direct-run', 'pure-direct-run'].includes(value));
        if (directRoot && directMode) {
          await hub.edit('mode', directMode);
          await hub.edit('directRoot', directRoot);
          assert.equal((await hub.field('directRoot')).value, directRoot);
        }
        for (const surface of ['Single Entry', 'Runner']) {
          if (surface === 'Runner') await hub.addRunner();
          await hub.wait(async () => (await hub.providerLabels()).includes(`Effective Provider: ${providerLabel(provider)}`),
            'Effective Provider unavailable: ' + surface);
          const startupLabel = providerLabel(process.env.HUB_EXPECTED_STARTUP_PROVIDER ?? provider);
          await hub.wait(async () => (await hub.providerLabels()).includes(`Configured Startup Provider: ${startupLabel}`),
            'Configured Startup Provider unavailable: ' + surface);
        }
        const after = await inspection(browser, connection);
        assert.equal(after.result.reply.revision, before.result.reply.revision, 'Hub draft must not apply native configuration');
        return { method: 'actual Hub draft selection from ordinary authenticated catalog',
          identity: { session: connection.session, generation: connection.generation },
          initialInspection: receiptEvidence(before), catalog: receiptEvidence(catalog),
          uiCatalogAgreesWithNative: true, draftPersisted: true, nativeRevisionUnchanged: true,
          edited: { account: true, model: true, mode: true, reasoning: !!reasoning, fast: !fast.disabled,
            target: !!target, directRoot: !!(directRoot && directMode) },
          workAdmission: 'not exercised', workStart: 'not exercised' };
      } finally { await stopWatching(browser); }
    }
  });
}
