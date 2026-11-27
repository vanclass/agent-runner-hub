import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, stopWatching, correlated, visibleConnection, visibleConfiguration } from './runner-flow.mjs';
import { HubActions } from './hub-actions.mjs';
import { terminalBuffer, canonicalRecords } from './terminal-buffer.mjs';

async function geometry(browser) {
  return browser.execute(() => {
    const input = document.querySelector('textarea[data-instruction]');
    const terminal = document.querySelector('.terminal-host');
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    return { input: rect(input), terminal: rect(terminal), draftLength: input?.value.length };
  });
}

// One explicit harmless Provider instruction; inherit the verified startup account/model.
async function semanticWork(browser, hub, connection, workRoot, route, presentation) {
  const single = route === 'single-entry';
  const canonicalConfig = await visibleConfiguration(browser, connection);
  if (single) await hub.selectSingleEntry();
  await hub.selectProviderAccount(canonicalConfig.effective.agent_id, canonicalConfig.current.account);
  let mode;
  await hub.wait(async () => {
    mode = await hub.field('mode');
    return mode && !mode.disabled && mode.options.some(option => option.value && !option.disabled);
  }, 'Requested mode catalog did not settle after account selection');
  const supported = mode.options.some(option => option.value === 'pure-direct-run' && !option.disabled);
  if (!supported) throw new BlockedPrerequisite('Installed Runner does not offer Pure Direct for isolated semantic work acceptance');
  await hub.edit('mode', 'pure-direct-run');
  await hub.edit('directRoot', workRoot);
  const instruction = single
    ? 'Reply HUB_SINGLE_ENTRY_ACCEPTANCE. No tools or file/settings changes.'
    : ['Reply with exactly HUB_LONG_COMPOSER_ACCEPTANCE. Do not use tools, modify files, run commands or change settings.',
      ...Array.from({ length: 24 }, (_, i) => `읽기 전용 확인 ${i + 1}: Korean/English multiline presentation check only.`)].join('\n');
  const compact = presentation ? await geometry(browser) : undefined;
  const retainedLine = presentation && !single
    ? (await terminalBuffer(browser)).full.split('\n').find(line => line.trim()) : undefined;
  await hub.draft(route, instruction);
  assert.equal((await hub.instructionState(route)).value, instruction);
  const editing = presentation ? await geometry(browser) : undefined;
  const previousRequests = await browser.execute(async () => {
    return (await Promise.all(Object.keys(window.__wg3Observation.snapshots).map(async id =>
      window.__TAURI_INTERNALS__.invoke('runner_observe', { id })))).flatMap(s => s.features?.results ?? [])
      .filter(r => r.feature === 'work' && r.operation === 'work.submit').map(r => r.id);
  });
  await hub.submit(route);
  const entered = presentation ? await geometry(browser) : undefined;
  connection = await visibleConnection(browser);
  let submitted, completed, instructionPublication;
  await browser.waitUntil(async () => {
    const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
    submitted ??= snapshot.features.results.find(r => r.feature === 'work' && r.operation === 'work.submit'
      && !previousRequests.includes(r.id));
    if (submitted?.state === 'rejected') throw new BlockedPrerequisite('Read-only work rejected: ' + submitted.code);
    if (submitted?.state === 'outcome-unknown') throw new UnverifiedObservation('Work effect unknown; do not replay');
    const observations = snapshot.features.results.filter(r => r.feature === 'work').flatMap(r => [r.reply?.work, ...(r.reply?.works ?? [])]).filter(Boolean);
    completed = submitted && observations.find(work => work.submission_request_id === submitted.id && work.terminal);
    if (presentation && !instructionPublication) {
      const buffer = await terminalBuffer(browser);
      if (buffer.full.replace(/\s/g, '').includes(instruction.replace(/\s/g, '')))
        instructionPublication = { buffer, workTerminal: !!completed };
    }
    return !!completed;
  }, { timeout: subagentCompletionMs, timeoutMsg: 'Original work completion unverified; do not resubmit' }).catch(error => {
    error.message += ': ' + JSON.stringify({ identity: { tab: connection.tab, session: connection.session,
      generation: connection.generation }, requestId: submitted?.id, state: submitted?.state,
      geometry: { compact, editing, entered } });
    if (error instanceof BlockedPrerequisite) throw error;
    throw new UnverifiedObservation(error.message);
  });
  assert.ok(submitted && completed.started_event_id > 0, 'Canonical work start must be observed');
  assert.equal(completed.outcome, 'succeeded', 'Actual read-only Provider work must succeed');
  const identity = { tab: connection.tab, session: connection.session, generation: connection.generation };
  const result = { originalRequestId: submitted.id, started: completed.started_event_id,
    outcome: completed.outcome, identity, draftCleared: true };
  if (!presentation) {
    await hub.wait(async () => {
      const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke(
        'runner_observe', { id }), connection.session), connection);
      const execution = snapshot.observation?.execution;
      return execution?.lifecycle_state === 'INTERACTIVE_READY'
        && execution.owned_execution_alive === false && execution.workflow_kind === '';
    }, 'Completed work did not release its owned execution');
    if (single) await hub.selectSingleEntry();
    assert.equal((await hub.instructionState(route)).value, '', 'Canonical start clears the originating draft');
    return { ...result, executionReleased: true };
  }
  const reply = single ? 'HUB_SINGLE_ENTRY_ACCEPTANCE' : 'HUB_LONG_COMPOSER_ACCEPTANCE';
  await browser.waitUntil(async () => (await terminalBuffer(browser)).full.includes(reply), { timeout: startupMs });
  const confirmed = await geometry(browser);
  assert.equal(confirmed.draftLength, 0, 'Canonical start clears the unchanged draft');
  if (!single) {
    assert.ok(editing.input.height > compact.input.height, 'Long editing expands');
    assert.ok(entered.input.height < editing.input.height, 'Enter compacts');
    assert.ok(entered.input.top >= entered.terminal.bottom, 'Composer does not cover output');
  }
  let originalInstructionBufferCount;
  if (single) {
    const normalize = text => text.replace(/\s/g, '');
    originalInstructionBufferCount = normalize((await terminalBuffer(browser)).full).split(normalize(instruction)).length - 1;
    if (originalInstructionBufferCount !== 1) throw new UnverifiedObservation(
      'Original instruction exact buffer count ' + originalInstructionBufferCount + '; no synthetic echo: '
      + JSON.stringify({ requestId: submitted.id, started: completed.started_event_id, outcome: completed.outcome,
        tab: connection.tab, session: connection.session, generation: connection.generation }));
    assert.equal(originalInstructionBufferCount, 1, 'Original PTY instruction retained');
  }
  let released;
  await browser.waitUntil(async () => {
    const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
    const observation = snapshot.observation;
    const marker = await browser.execute(tab => {
      const row = [...document.querySelectorAll('.runner-row')].find(r => r.dataset.runnerId === tab);
      const dot = row?.querySelector('.status-dot');
      return dot && { activity: dot.className, label: dot.getAttribute('aria-label'), color: getComputedStyle(dot).color };
    }, connection.tab);
    released = { observation, marker, age: snapshot.observationAgeMs };
    return snapshot.state === 'ready' && observation?.execution.lifecycle_state === 'INTERACTIVE_READY'
      && observation.execution.owned_execution_alive === false && observation.execution.workflow_kind === ''
      && marker?.activity === 'status-dot idle';
  }, { timeout: startupMs, timeoutMsg: 'Completed work did not produce verified released Idle sidebar authority' });
  assert.equal(released.marker.color, 'rgb(34, 197, 94)');
  assert.equal(released.marker.label, 'Verified idle');
  const buffer = await terminalBuffer(browser), output = buffer.full;
  const canonical = await canonicalRecords(browser, connection);
  const scrollback = { rows: buffer.length, startupRetained: output.includes(retainedLine) };
  if (!single) assert.ok(scrollback?.startupRetained, 'Original startup scrollback retained');
  const normalize = text => text.replace(/\s/g, '');
  const count = normalize(output).split(normalize(instruction)).length - 1;
  assert.equal(normalize(canonical.text).split(normalize(instruction)).length - 1, 1, 'Canonical instruction appears once');
  assert.equal(count, 1, 'Original instruction appears once in canonical output: '
    + JSON.stringify({ requestId: submitted.id, started: completed.started_event_id, outcome: completed.outcome,
      identity: { tab: connection.tab, session: connection.session, generation: connection.generation },
      matchingRows: output.split('\n').filter(line => /Reply|HUB_SINGLE|tools|changes/.test(line)) }));
  return { originalRequestId: submitted.id, started: completed.started_event_id > 0, outcome: completed.outcome,
    terminalReplyObserved: true, instructionCount: count, buffer, canonical, released,
    originalInstructionBufferCount,
    identity: { tab: connection.tab, session: connection.session, generation: connection.generation },
    geometry: { compact, editing, entered, confirmed }, instructionPublication,
    scrollback,
    accountAndModel: 'inherited from verified canonical startup configuration' };
}

export function semanticWorkCase(runnerRoot, workRoot, route = 'runner', presentation = false) {
  const id = route === 'single-entry' ? 'single-entry-work' : 'semantic-work';
  return defineNativeCase({
    id: presentation ? id + '-presentation' : id,
    presentation: presentation ? 'nonactivating' : 'background',
    ready: browser => readyInstalledHub(browser, runnerRoot),
    async run(browser) {
      const hub = new HubActions(browser);
      try {
        await hub.addRunner();
        const connection = await visibleConnection(browser, runnerRoot);
        return await semanticWork(browser, hub, connection, workRoot, route, presentation);
      } finally { await stopWatching(browser); }
    },
    async observe(browser) {
      const hub = new HubActions(browser);
      const terminal = await hub.dom.state('.terminal-host');
      const composer = await hub.instructionState('runner');
      assert.ok(terminal.rect.width > 0 && terminal.rect.height > 100);
      assert.ok(composer.rect.top >= terminal.rect.bottom);
      const rendered = await browser.execute(() => ({
        visibility: getComputedStyle(document.querySelector('.terminal-host')).visibility,
        semanticRenderers: document.querySelectorAll('.runner-semantic').length
      }));
      assert.deepEqual(rendered, { visibility: 'visible', semanticRenderers: 0 });
      return { terminal: terminal.rect, composer: composer.rect };
    }
  });
}
