import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { defineNativeCase, BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { HubActions } from './hub-actions.mjs';
import { correlated, readyInstalledHub, stopWatching, visibleConfiguration, visibleConnection } from './runner-flow.mjs';
import { terminalBuffer } from './terminal-buffer.mjs';

export function attachmentWorkCase(runnerRoot, workRoot) {
  return defineNativeCase({
    id: 'attachment-work', presentation: 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      const hub = new HubActions(browser);
      const surface = 'runner';
      try {
        await hub.addRunner();
        const connection = await visibleConnection(browser, runnerRoot);
        const config = await visibleConfiguration(browser, connection);
        await hub.selectProviderAccount(config.effective.agent_id, config.current.account);
        await hub.edit('mode', 'pure-direct-run').catch(error => { throw new BlockedPrerequisite(error.message); });
        await hub.edit('directRoot', workRoot);

        const instruction = 'Name the solid color of the attached image in one English word. Use UNKNOWN if there is no image. Do not use tools or change any files or settings.';
        await hub.draft(surface, '');
        assert.equal((await hub.attachments.pasteText(surface, instruction)).inserted, true);
        assert.equal((await hub.instructionState(surface)).value, instruction);
        const bytes = PNG.sync.write({ width: 32, height: 32,
          data: Buffer.alloc(32 * 32 * 4, Buffer.from([0, 0, 255, 255])) });
        await hub.attachments.pasteImage(surface, { bytes, name: 'attachment-probe.png', type: 'image/png' });
        await hub.wait(async () => {
          const state = await hub.attachments.inventory(surface);
          return state?.items.length === 1 && state.items[0].thumbnail?.width === 32 && !state.items[0].status;
        }, 'Clipboard image did not stage in the selected Runner');
        const observe = async () => correlated(await browser.execute(
          id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
        const before = await observe();
        const priorWork = new Set(before.features.results.map(result => result.id));
        const priorReferences = new Set(before.references.results.map(result => result.id));
        await hub.submit(surface);

        let registration, inventory, submitted, work;
        await hub.wait(async () => {
          const snapshot = await observe();
          const references = snapshot.references.results.filter(result => !priorReferences.has(result.id));
          registration ??= references.find(result => result.operation === 'references.register'
            && result.state === 'registered' && result.reference?.kind === 'file'
            && /^image-[a-f0-9]{32}\.png$/i.test(result.reference.display_name));
          inventory ??= registration && references.find(result => result.operation === 'references.list'
            && result.id > registration.id && result.inventory?.total_count === 1
            && result.inventory.references[0]?.reference_id === registration.reference.reference_id);
          const attempts = snapshot.features.results.filter(result => !priorWork.has(result.id)
            && result.feature === 'work' && result.operation === 'work.submit');
          assert.ok(new Set(attempts.map(result => result.id)).size <= 1, 'Only one Work submission');
          submitted = attempts.at(-1) ?? submitted;
          if (submitted?.state === 'rejected') throw new BlockedPrerequisite('Work rejected: ' + submitted.code);
          if (submitted?.state === 'outcome-unknown') throw new UnverifiedObservation('Original Work outcome unknown');
          work = submitted && snapshot.features.results.filter(result => result.feature === 'work')
            .flatMap(result => [result.reply?.work, ...(result.reply?.works ?? [])])
            .find(item => item?.submission_request_id === submitted.id && item.terminal);
          return !!work;
        }, 'Original attachment Work did not reach an authoritative terminal observation', subagentCompletionMs);
        assert.ok(registration && inventory, 'Authoritative registration and pre-delivery inventory must agree');
        assert.ok(work.started_event_id > 0, 'Original Work start must be confirmed');
        assert.equal(work.outcome, 'succeeded');
        await hub.wait(async () => (await hub.instructionState(surface)).value === ''
          && (await hub.attachments.inventory(surface)).items.length === 0, 'Confirmed delivery did not retire the draft and card');
        await hub.wait(async () => /^\s*blue[.!]?\s*$/im.test((await terminalBuffer(browser)).full),
          'Provider reply did not identify the submitted image color');
        return { tab: connection.tab, session: connection.session, generation: connection.generation,
          registrationId: registration.id, referenceId: registration.reference.reference_id,
          inventoryId: inventory.id, workId: submitted.id, startedEventId: work.started_event_id,
          outcome: work.outcome, providerColor: 'blue' };
      } finally {
        await stopWatching(browser);
      }
    }
  });
}
