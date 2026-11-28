import assert from 'node:assert/strict';
import { BlockedPrerequisite, defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { HubActions } from './hub-actions.mjs';
import { readyInstalledHub, visibleConnection, visibleConfiguration, inspectRequest, readConfigRequest, stopWatching } from './runner-flow.mjs';
import { mountedRunner } from './mounted-runner.mjs';

export function quickSettings(runnerRoot) {
  return defineNativeCase({
    id: 'quick-settings', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      const hub = new HubActions(browser);
      const selector = '.quick-grid > button';
      const button = index => selector + ':nth-child(' + index + ')';
      let field;
      async function click(index, stage = 'initial') {
        field = index;
        const trigger = button(index);
        await hub.wait(async () => (await mountedRunner(browser, 'quick-state'))?.quick
          && browser.execute(trigger =>
            document.querySelector(trigger)?.getAttribute('aria-disabled') === 'false', trigger), 'Quick control unavailable: ' + index)
          .catch(async error => { throw new Error(error.message + ' (' + stage + ') ' + JSON.stringify(await mountedRunner(browser, 'quick-state'))); });
        await hub.dom.click(trigger);
      }
      async function choices() {
        await hub.wait(() => browser.execute(() => !!document.querySelector('.quick-popover button.quick-option')),
          'Runner quick candidate list did not render for control ' + field).catch(async error => {
          const popup = await hub.dom.state('.quick-popover [role="status"]');
          throw new Error(error.message + ': ' + (popup?.text ?? 'popover unavailable'));
        });
        return browser.execute(() => [...document.querySelectorAll('.quick-popover button.quick-option')].map(node => ({
          value: node.lastElementChild.firstChild.textContent, selected: node.getAttribute('aria-current') === 'true',
          enabled: node.getAttribute('aria-disabled') === 'false'
        })));
      }
      const close = () => hub.dom.click('.quick-grid > button[aria-expanded="true"]');
      const choose = (options, candidate) => hub.dom.click('.quick-popover .quick-option:nth-of-type(' + (options.indexOf(candidate) + 1) + ')');
      const observe = async matches => {
        let observation;
        await hub.wait(async () => {
          const snapshot = await hub.observations.snapshot(connection);
          observation = snapshot.observation;
          return observation && matches(observation);
        }, 'Quick setting did not reach the effective Runner observation');
        return observation;
      };
      let connection;
      const readCurrent = async () => {
        await hub.wait(async () => (await mountedRunner(browser, 'quick-state'))?.quick,
          'Quick settings have not finished verifying the previous operation');
        return visibleConfiguration(browser, connection);
      };
      try {
        await hub.addRunner();
        connection = await visibleConnection(browser, runnerRoot);
        const features = connection.snapshot.features.sessionConfig.operations;
        if (!['session_config.providers', 'session_config.select_provider'].every(operation => features.includes(operation)))
          throw new BlockedPrerequisite('Configured Runner has no authenticated Provider selection capability');
        await click(1);
        const providers = await choices();
        assert.equal(providers.filter(p => p.selected).length, 1);
        assert.ok(providers.some(p => p.value));
        await close();
        const before = await readCurrent();
        if (!before.current.account.profile_name || before.model_catalog_status !== 'available')
          throw new BlockedPrerequisite('Configured Runner has no verified current account/model catalog.');
        await click(2);
        const accounts = await choices();
        assert.ok(accounts.some(account => account.selected && account.value === before.effective.account));
        await close();
        await click(3);
        const models = await choices();
        assert.ok(models.some(model => model.selected && model.value === before.effective.model));
        await close();
        await click(4);
        const efforts = await choices();
        const next = efforts.find(effort => effort.enabled && !effort.selected);
        if (!next) throw new BlockedPrerequisite('No alternate reasoning effort advertised by the current model.');
        await choose(efforts, next);
        await hub.wait(() => browser.execute(({ trigger, value }) =>
          document.querySelector(trigger)?.textContent === value, { trigger: button(4), value: next.value }),
        'Effective reasoning did not update from the confirmed Runner change');
        const after = await readCurrent();
        assert.equal(after.current.model.reasoning_effort, next.value);
        assert.equal(after.effective.reasoning_effort, next.value);
        assert.ok(connection.snapshot.observation.context_location, 'Authenticated context_location missing');
        let switchedAccount = false;
        for (const account of after.options.accounts.filter(a => a.profile_name !== after.current.account.profile_name)) {
          const destination = await inspectRequest(browser, connection, { operation: 'session_config.inspect',
            api_version: 1, account, offset: 0 });
          if (destination.result.state !== 'accepted' || !destination.result.reply.options.models.some(model =>
            model.id === after.current.model.id && model.reasoning_efforts.includes(next.value)
              && model.service_tiers.includes(after.current.service_tier))) continue;
          await click(2, 'destination account');
          const available = await choices();
          const option = available.find(o => o.value === account.profile_name && o.enabled);
          if (!option) { await close(); continue; }
          await choose(available, option);
          await observe(o => o.selection.account === account.profile_name);
          switchedAccount = true;
          break;
        }
        const updated = await readCurrent();
        const compatibleModels = updated.options.models.filter(model => model.id !== updated.current.model.id
          && model.reasoning_efforts.includes(updated.current.model.reasoning_effort)
          && model.service_tiers.includes(updated.current.service_tier));
        const otherModel = compatibleModels.find(model => model.service_tiers.includes('fast')) ?? compatibleModels[0];
        let switchedModel = false;
        if (otherModel) {
          await click(3);
          const available = await choices();
          const option = available.find(o => o.value === otherModel.id && o.enabled);
          if (option) { await choose(available, option); await observe(o => o.selection.model === otherModel.id); switchedModel = true; }
          else await close();
        }
        const configured = await readCurrent();
        const model = configured.options.models.find(m => m.id === configured.current.model.id);
        let fastToggled = false;
        if (model?.service_tiers.includes('fast') && model.service_tiers.includes('default')) {
          await click(5);
          await observe(o => o.selection.service_tier !== configured.effective.service_tier);
          fastToggled = true;
        }
        await click(6);
        const modes = await choices();
        const mode = modes.find(o => !o.selected && o.enabled && ['Task Run', 'Issue Run'].includes(o.value));
        assert.ok(mode, 'No alternative Target-based mode in native inventory (' + modes.filter(o => o.enabled).length + ' enabled)');
        await choose(modes, mode);
        await observe(o => o.run_mode === (mode.value === 'Issue Run' ? 'issue-run' : 'task-run'));
        await click(7);
        const targets = await choices();
        const target = targets.find(o => !o.selected && o.enabled);
        assert.ok(target, 'No enabled alternate Target (' + targets.length + ' choices, '
          + targets.filter(o => o.enabled).length + ' enabled)');
        await choose(targets, target);
        await observe(o => o.context_location?.kind === 'target');
        await click(6);
        const allModes = await choices();
        const direct = allModes.find(o => o.enabled && o.value === 'Direct Run');
        assert.ok(direct, 'Native Run Mode catalog must expose Direct Run');
        await choose(allModes, direct);
        await hub.dom.changeValue('.quick-popover input', 'hub-relative-root-validation');
        await hub.dom.click('.quick-popover button[type="submit"]');
        await hub.wait(() => browser.execute(() => !!document.querySelector('.quick-feedback[role="status"]')),
          'Runner did not present its invalid-root rejection');
        const rejectedRoot = await hub.observations.snapshot(connection);
        assert.equal(rejectedRoot.observation.context_location.kind, 'target');
        assert.ok(rejectedRoot.features.results.some(r => r.operation === 'session_config.plan' && r.state === 'rejected'
          && r.reply?.plan_status === 'invalid'), 'Runner must reject the invalid directory through its plan owner');
        const providerCatalog = await readConfigRequest(browser, connection, { operation: 'session_config.providers', api_version: 1 });
        const none = providerCatalog.result.reply.providers.find(p => p.agent_id === 'none' && p.available);
        let switchedProvider = false;
        if (none) {
          await click(1);
          const available = await choices();
          const option = available.find(p => p.value === none.label && p.enabled);
          assert.ok(option, 'Runner-advertised None selection missing');
          await choose(available, option);
          await observe(o => o.selection.agent_id === 'none');
          switchedProvider = true;
        }
        return { authenticated: true, providers: providers.length, accounts: accounts.length, models: models.length,
          reasoningCommitted: true, effectiveConfirmed: true, switchedAccount, switchedModel, fastToggled, switchedProvider,
          modeChanged: true, targetChanged: true, invalidRootRejected: true, contextLocation: 'target' };
      } finally { await stopWatching(browser); }
    },
  });
}
