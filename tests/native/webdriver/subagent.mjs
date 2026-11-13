import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, ownedConnection, correlated, stopWatching } from './runner-flow.mjs';

export function subagentRun(runnerRoot) {
  return defineNativeCase({
    id: 'subagent-run', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      try {
        const connection = await ownedConnection(browser, runnerRoot);
        await browser.waitUntil(async () => browser.execute(() => {
          const account = document.querySelector('.context-settings .account-settings select');
          return account && !account.disabled && account.options.length > 1;
        }), { timeout: startupMs, timeoutMsg: 'Startup configuration catalog not settled' }).catch(async () => {
          const diagnostic = await browser.execute(async id => {
            const view = await window.__TAURI_INTERNALS__.invoke('runner_observe', { id });
            return { state: view.state, generation: view.features?.generation,
              controls: ['.account-settings select', '.model-settings select'].map(selector => {
                const element = document.querySelector('.context-settings ' + selector);
                return { selector, present: !!element, disabled: element?.disabled, options: element?.options.length };
              }), configuration: view.features?.results.filter(r => r.feature === 'session_config').map(r => ({
                operation: r.operation, state: r.state, phase: r.phase, code: r.code,
                catalog: r.reply?.model_catalog_status, setupRequired: r.reply?.setup_required, availability: r.reply?.availability })) };
          }, connection.session);
          throw new BlockedPrerequisite('Startup configuration catalog unavailable: ' + JSON.stringify(diagnostic));
        });
        await browser.execute(() => document.querySelector('.add-runner').click());
        await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.runner-row.active')),
          { timeout: startupMs, timeoutMsg: 'Owned tab promotion unavailable' });
        if (!connection.snapshot.features.work?.run_modes.includes('subagent-run'))
          throw new BlockedPrerequisite('Installed Runner does not advertise subagent-run configuration.');
        const feature = async (name, request) => {
          const admission = await browser.execute((id, feature, request) => window.__TAURI_INTERNALS__.invoke(
            'runner_feature', { id, request: { feature, request } }), connection.session, name, request);
          if (admission.state !== 'submitted' || admission.generation !== connection.generation)
            throw new UnverifiedObservation('Native admission unconfirmed; no replay: ' + JSON.stringify(admission));
          let receipt;
          await browser.waitUntil(async () => {
            const view = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
            receipt = view.features.results.find(r => r.id === admission.id && r.feature === name && r.operation === request.operation && r.phase === 'completed');
            return !!receipt;
          }, { timeout: startupMs, timeoutMsg: 'Native receipt unavailable; no replay' });
          if (receipt.state !== 'accepted') throw new BlockedPrerequisite('Native operation rejected: ' + request.operation + ': ' + receipt.code);
          return receipt.reply;
        };
        const config = await feature('session_config', { operation: 'session_config.inspect', api_version: 1, offset: 0 });
        const target = config.options.targets.find(t => t.owner === 'Project' && t.project === 'AgentRunnerHub');
        if (!target) throw new BlockedPrerequisite('Exact AgentRunnerHub target absent from authenticated catalog');
        const desired = { run_mode: 'subagent-run', target: target.id };
        const plan = await feature('session_config', { operation: 'session_config.plan', api_version: 1, desired });
        if (plan.plan_status !== 'ready' || plan.required_confirmations.length)
          throw new BlockedPrerequisite('Owned Runner mode transition requires unresolved confirmation: ' + JSON.stringify(plan.required_confirmations));
        if (Object.keys(plan.changes).length) {
          const apply = await feature('session_config', { operation: 'session_config.apply', api_version: 1, desired,
            revision: plan.revision, plan_id: plan.plan_id });
          assert.equal(apply.apply_status, 'applied');
        }
        let commandView;
        await browser.waitUntil(async () => {
          commandView = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
          const flatten = commands => commands.flatMap(c => [c, ...flatten(c.children ?? [])]);
          return commandView.observation.run_mode === 'subagent-run'
            && flatten(commandView.observation.commands).some(c => c.text === '/run' && c.visible && c.enabled);
        }, { timeout: startupMs }).catch(() => {
          throw new BlockedPrerequisite('Configured subagent /run unavailable: ' + JSON.stringify({
            mode: commandView?.observation.run_mode, attention: commandView?.observation.attention }));
        });
        const command = await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_command', { id, command: '/run' }), connection.session);
        if (command.state !== 'submitted') throw new UnverifiedObservation('Subagent /run admission: ' + JSON.stringify(command));
        await browser.waitUntil(async () => browser.execute(() => !![...document.querySelectorAll('.runner-interaction button')]
          .find(b => !b.disabled && /interpreter|인터프리터/i.test(b.textContent))),
          { timeout: startupMs, timeoutMsg: 'Registered Interpreter choice not rendered by Hub' });
        const role = await browser.execute(() => {
          const button = [...document.querySelectorAll('.runner-interaction button')].find(b => !b.disabled && /interpreter|인터프리터/i.test(b.textContent));
          const selectedLabel = button.textContent; button.click(); return selectedLabel;
        });
        await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-interaction h4')),
          { timeout: startupMs, timeoutMsg: 'Registered role selection did not settle' });
        const instruction = 'Read only package.json in the bound target and report its package name. Do not modify any files, run tools with side effects, or publish. This is a Hub integration probe.';
        const submitted = await feature('work', { operation: 'work.submit', api_version: 1, instruction });
        assert.equal(submitted.receipt, 'dispatch_received');
        const original = submitted.work.submission_request_id, observations = [];
        let latest;
        await browser.waitUntil(async () => {
          const view = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
          const candidates = view.features.results.filter(r => r.feature === 'work' && r.state === 'accepted' && r.phase === 'completed')
            .flatMap(r => r.reply?.works ?? (r.reply?.work ? [r.reply.work] : []))
            .filter(w => w.submission_request_id === original && w.observation_id === `api:${original}`)
            .sort((a, b) => b.event_id - a.event_id);
          if (candidates[0] && (!latest || candidates[0].event_id >= latest.event_id)) latest = candidates[0];
          if (latest && observations.at(-1)?.event_id !== latest.event_id) observations.push(latest);
          return latest?.terminal;
        }, { timeout: subagentCompletionMs, timeoutMsg: 'Subagent actual completion unverified; no instruction replay' })
          .catch(error => { throw new UnverifiedObservation(error.message + ': ' + JSON.stringify({ role, original, observations })); });
        assert.equal(latest.run_mode, 'subagent-run'); assert.equal(latest.work_id.kind, 'subagent_turn');
        assert.ok(latest.started_event_id > 0); assert.equal(latest.outcome, 'succeeded'); assert.ok(latest.result);
        await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.runner-work-status pre')?.textContent),
          { timeout: startupMs, timeoutMsg: 'Canonical native result not rendered by current Hub' });
        const displayed = await browser.execute(() => JSON.parse(document.querySelector('.runner-work-status pre').textContent));
        assert.deepEqual(displayed, latest.result);
        return { method: 'current Candidate Hub / installed authenticated Runner', identity: { session: connection.session,
          generation: connection.generation }, role, instruction, original, observations, canonicalResult: latest.result, displayed };
      } finally { await stopWatching(browser); }
    }
  });
}
