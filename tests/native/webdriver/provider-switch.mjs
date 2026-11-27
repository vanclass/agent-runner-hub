import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';
import { HubActions } from './hub-actions.mjs';
import { readyInstalledHub, visibleConnection, ownedConnection, inspectRequest, inspection, stopWatching } from './runner-flow.mjs';
import { executionReleased, workSubmissions, workObservations } from './runner-observations.mjs';

async function interaction(hub, connection, fields) {
  const admission = await hub.browser.execute((id, fields) => window.__TAURI_INTERNALS__.invoke('runner_feature', {
    id, request: { feature: 'interaction', request: { api_version: 1, ...fields } },
  }), connection.session, fields);
  assert.equal(admission.state, 'submitted', 'Foreground input request must be sent once');
  assert.equal(admission.generation, connection.generation);
  let result;
  await hub.wait(async () => {
    const snapshot = await hub.observations.snapshot(connection);
    result = snapshot.features.results.find(r => r.id === admission.id && r.feature === 'interaction');
    return result && ['accepted', 'rejected', 'failure', 'outcome-unknown'].includes(result.state);
  }, 'Foreground input receipt unavailable');
  assert.equal(result.state, 'accepted', result.code);
  return result.reply;
}

async function switchProvider(hub, connection, label, agentId) {
  const isChoice = choice => choice.label === label || (agentId === 'none' && choice.label === '없음');
  await hub.draft('runner', '/provider');
  await hub.wait(async () => {
    const state = await hub.observations.active();
    return state?.fresh && !state.controlBusy;
  }, 'Owned Runner command control did not become ready for Provider selection');
  const before = (await hub.observations.snapshot(connection)).results.at(-1)?.id ?? 0;
  await hub.submit('runner');
  let view, command;
  await hub.wait(async () => {
    const snapshot = await hub.observations.snapshot(connection);
    command = snapshot.results.find(r => r.id > before && r.command === '/provider');
    if (command && ['rejected', 'failure', 'outcome-unknown'].includes(command.state))
      throw new Error('Provider command ' + command.state + ': ' + command.code);
    if (command?.state !== 'pending-interaction' && !snapshot.observation?.attention.foreground_interaction_active) return false;
    if (!snapshot.features.interaction) throw new BlockedPrerequisite('Installed Runner lacks structured foreground input');
    view = (await interaction(hub, connection, { operation: 'interaction.observe' })).interaction;
    return view?.state === 'active' && view.choices.some(choice => isChoice(choice) && choice.enabled);
  }, 'Session Provider choices unavailable').catch(async error => {
    const mounted = await hub.observations.active();
    error.message += ' ' + JSON.stringify({ command, prompt: view?.prompt, choices: view?.choices?.map(c => c.label),
      activity: mounted?.activity, editor: (await hub.instructionState('runner'))?.value,
      foreground: mounted?.observation?.attention.foreground_interaction_active });
    throw error;
  });
  await interaction(hub, connection, { operation: 'interaction.respond', interaction_id: view.interaction_id,
    action: 'select', choice_id: view.choices.find(isChoice).choice_id });
  await hub.wait(async () => {
    view = (await interaction(hub, connection, { operation: 'interaction.observe' })).interaction;
    return view?.state === 'active' && view.choices.some(isChoice);
  }, 'Provider menu did not return after selection');
  await interaction(hub, connection, { operation: 'interaction.respond', interaction_id: view.interaction_id, action: 'back' });
  await hub.wait(async () => {
    const snapshot = await hub.observations.snapshot(connection);
    return snapshot.observation?.selection.agent_id === agentId
      && snapshot.observation.attention.foreground_interaction_active === false;
  }, 'Effective Provider did not settle: ' + agentId);
}

async function readChoices(hub, connection, provider, startup) {
  const label = { codex: 'Codex', claude: 'Claude', none: 'None' }[provider];
  let fields, account, model, labels;
  if (provider !== 'none') {
    const { observation } = await hub.observations.snapshot(connection);
    const active = { agent_id: provider, profile_name: observation.selection.account };
    await hub.wait(async () => {
      labels = await hub.providerLabels();
      account = await hub.field('account');
      return labels[0]?.endsWith(label) && account && !account.disabled
        && account.options.some(o => !o.disabled && o.value?.agent_id === provider);
    }, 'Hub accounts did not refresh for ' + provider);
    if (!account.value && account.options.some(o => !o.disabled
      && o.value?.agent_id === provider && o.value?.profile_name === active.profile_name))
      await hub.selectProviderAccount(provider, active);
  }
  await hub.wait(async () => {
    labels = await hub.providerLabels();
    account = await hub.field('account');
    model = await hub.field('model');
    if (!labels[0]?.endsWith(label) || !account || !model || account.disabled || model.disabled) return false;
    const accounts = account.options.filter(o => o.value && !o.disabled).map(o => o.value);
    const models = model.options.filter(o => o.value && !o.disabled).map(o => o.value);
    if (provider === 'none' ? accounts.length || models.length : !accounts.length || !models.length) return false;
    assert.ok([...accounts, ...models].every(v => v.agent_id === provider));
    fields = { account: account.value, model: model.value, accounts: accounts.length, models: models.length,
      reasoning: (await hub.field('reasoning')).options.map(o => o.value), fast: await hub.field('fast') };
    return true;
  }, 'Hub configuration did not refresh for ' + provider).catch(async error => {
    const { features } = await hub.observations.snapshot(connection);
    error.message += ' ' + JSON.stringify({ labels, account: account?.value, model: model?.value,
      receipts: features.results.filter(r => r.feature === 'session_config').map(({ state, code, reply }) => ({
        state, code, models: reply?.options_page?.totals?.models, reason: reply?.model_catalog_status,
      })) });
    throw error;
  });
  const { observation, features } = await hub.observations.snapshot(connection);
  assert.equal(observation.selection.agent_id, provider);
  assert.equal(observation.configured_startup_agent_id, startup);
  return { provider, startup, labels: await hub.providerLabels(), ...fields,
    fast: { value: fields.fast.value, disabled: fields.fast.disabled },
    commands: observation.commands.filter(c => c.enabled && c.visible).map(c => c.text),
    configuration: features.sessionConfig?.operations };
}

async function submitProbe(hub, connection, provider, surface) {
  const selected = await inspectRequest(hub.browser, connection, {
    operation: 'session_config.inspect', api_version: 1, execution_context: 'test', agent_id: provider,
  });
  if (selected.result.state !== 'accepted') throw new BlockedPrerequisite('Configured test account unavailable: ' + provider);
  const account = selected.result.reply.account;
  await hub.selectProviderAccount(provider, account);
  await hub.edit('mode', 'pure-direct-run');
  const current = await inspection(hub.browser, connection);
  const root = current.result.reply.current.root;
  if (!root) throw new BlockedPrerequisite('Configure a Pure Direct working root in the installed Runner');
  await hub.edit('directRoot', root);
  const model = await hub.field('model');
  const choices = model.options.filter(o => !o.disabled && o.value);
  const option = choices.find(o => o.value.model === current.result.reply.current.model.id) ?? choices[0];
  assert.ok(option, 'Verified test-account model required');
  await hub.edit('model', option.value);
  const before = new Set(workSubmissions(await hub.observations.snapshot(connection)).map(r => r.id));
  await hub.draft(surface, 'Reply with the Provider name and then the word VERIFIED. Use no tools and modify nothing.');
  await hub.submit(surface);
  let result, selection, snapshot;
  await hub.wait(async () => {
    snapshot = await hub.observations.snapshot(connection);
    const receipt = workSubmissions(snapshot).find(r => !before.has(r.id));
    if (receipt && ['rejected', 'outcome-unknown'].includes(receipt.state)) throw new Error('Work did not start: ' + receipt.state);
    const configuration = snapshot.features.results.at(-1);
    if (!receipt && configuration?.operation === 'session_config.plan' && configuration.phase === 'completed'
      && configuration.reply?.plan_status !== 'ready') throw new Error('Selected configuration was not ready');
    const work = receipt && workObservations(snapshot).find(w => w.submission_request_id === receipt.id);
    if (!work?.started_event_id) return false;
    selection ??= snapshot.observation?.selection;
    if (!work.terminal || !executionReleased(snapshot)) return false;
    result = work;
    return true;
  }, 'Provider work did not settle; do not replay', 120_000).catch(async error => {
    const { records } = await hub.logs.history();
    error.message += ' ' + JSON.stringify({
      receipts: snapshot?.features.results.map(({ operation, state, code, reply }) => ({
        operation, state, code, plan: reply?.plan_status, errors: reply?.errors,
        confirmations: reply?.required_confirmations, apply: reply?.apply_status,
      })),
      recentEvents: records.slice(-7).map(({ operation, actual, code }) => ({ operation, actual, code })),
    });
    throw error;
  });
  assert.equal(result.outcome, 'succeeded');
  assert.equal(selection.agent_id, provider);
  assert.equal(selection.account, account.profile_name);
  assert.equal(selection.model, option.value.model);
  return { provider, account, model: selection.model, request: result.submission_request_id, started: result.started_event_id };
}

export function providerSwitchCase(runnerRoot, workOnly = false) {
  return defineNativeCase({
    id: workOnly ? 'provider-work' : 'provider-switch', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      const hub = new HubActions(browser);
      try {
        const retained = await hub.addRunner();
        const retainedConnection = await visibleConnection(browser, runnerRoot);
        const retainedBefore = (await hub.observations.snapshot(retainedConnection)).observation.selection;
        const tab = await hub.addRunner();
        const connection = await visibleConnection(browser, runnerRoot);
        const snapshot = await hub.observations.snapshot(connection);
        const startup = snapshot.observation.configured_startup_agent_id;
        const start = snapshot.observation.selection.agent_id;
        if (!['codex', 'claude'].includes(start)) throw new BlockedPrerequisite('Codex or Claude startup is required');
        const labels = { codex: 'Codex', claude: 'Claude', none: 'None' };
        const other = start === 'codex' ? 'claude' : 'codex';
        const observations = [await readChoices(hub, connection, start, startup)];
        console.log('HUB_PROVIDER_OBSERVATION ' + JSON.stringify(observations[0]));
        for (const provider of workOnly ? [other] : [other, start, other, 'none', start, 'none', other]) {
          await switchProvider(hub, connection, labels[provider], provider);
          observations.push(await readChoices(hub, connection, provider, startup));
          console.log('HUB_PROVIDER_OBSERVATION ' + JSON.stringify(observations.at(-1)));
        }
        const active = await visibleConnection(browser, runnerRoot);
        assert.equal(active.tab, tab);
        assert.equal(active.session, connection.session);
        assert.equal(active.generation, connection.generation);
        await hub.selectRunner(retained);
        assert.deepEqual((await hub.observations.snapshot(retainedConnection)).observation.selection, retainedBefore);
        let work;
        if (workOnly) {
          await hub.selectRunner(tab);
          work = await submitProbe(hub, connection, other, 'runner');
        }
        await hub.selectSingleEntry();
        const ids = await browser.execute(() => Object.keys(window.__wg3Observation.snapshots));
        const spares = ids.filter(id => id !== connection.session && id !== retainedConnection.session);
        if (spares.length !== 1) throw new BlockedPrerequisite('Could not identify one owned hidden spare for Single Entry');
        const spare = await ownedConnection(browser, runnerRoot, spares[0]);
        const spareProvider = spare.snapshot.observation.selection.agent_id;
        let singleEntry;
        if (workOnly) {
          singleEntry = await submitProbe(hub, spare, spareProvider, 'single-entry');
        } else {
          const [label] = await hub.providerLabels();
          assert.ok(label?.endsWith(labels[spareProvider]));
          await hub.draft('single-entry', '/help');
          await hub.submit('single-entry');
          let receipt;
          await hub.wait(async () => {
            receipt = (await hub.observations.snapshot(spare)).results.find(r => r.command === '/help');
            return receipt?.phase === 'completed';
          }, 'Single Entry command completion unavailable');
          assert.equal(receipt.state, 'accepted');
          singleEntry = { provider: spareProvider, commandRequest: receipt.id };
        }
        const promoted = await visibleConnection(browser, runnerRoot);
        assert.equal(promoted.session, spare.session);
        assert.equal(promoted.generation, spare.generation);
        return { tab, session: connection.session, generation: connection.generation, observations,
          retainedUnchanged: true, work, singleEntry };
      } finally { await stopWatching(browser); }
    },
  });
}
