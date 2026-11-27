import assert from 'node:assert/strict';
import { defineNativeCase, BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, stopWatching, visibleConnection, visibleConfiguration } from './runner-flow.mjs';
import { executionReleased, observeSession, workSubmissions, workObservations } from './runner-observations.mjs';
import { HubActions } from './hub-actions.mjs';
import { mountedRunner } from './mounted-runner.mjs';

async function quickDirect(browser, hub, connection, root, initial) {
  const ready = () => hub.wait(async () => (await mountedRunner(browser, 'quick-state'))?.quick,
    'Runner quick settings did not settle');
  const modeButton = '.quick-grid > button:nth-child(6)';
  const rootButton = '.quick-grid > button:nth-child(7)';
  await ready();
  await hub.dom.click(initial.current.run_mode === 'pure-direct-run' ? rootButton : modeButton);
  if (initial.current.run_mode !== 'pure-direct-run') {
    const selected = await browser.execute(() => {
      const option = [...document.querySelectorAll('.quick-popover .quick-option')]
        .find(node => node.lastElementChild.textContent === 'Pure Direct Run' && node.getAttribute('aria-disabled') === 'false');
      option?.click();
      return !!option;
    });
    if (!selected) throw new BlockedPrerequisite('Pure Direct is unavailable in the authenticated quick Run Mode catalog');
  }
  await hub.dom.changeValue('.quick-popover input', root);
  await hub.dom.click('.quick-popover button[type="submit"]');
  await ready();
  const before = await visibleConfiguration(browser, connection);
  assert.equal(before.current.run_mode, 'pure-direct-run');
  assert.equal(before.current.root.replaceAll('\\', '/').toLowerCase(), root.replaceAll('\\', '/').toLowerCase());
  return before;
}

async function cancelProviderRelease(browser, hub, connection, agent) {
  const providerButton = '.quick-grid > button:first-child';
  await hub.wait(async () => (await mountedRunner(browser, 'quick-state'))?.quick, 'Provider control unavailable after work');
  await hub.dom.click(providerButton);
  const choose = (selector, labels) => browser.execute(({ selector, labels }) => {
    const option = [...document.querySelectorAll(selector)].find(button =>
      button.getAttribute('aria-disabled') !== 'true' && !button.disabled
      && labels.includes((button.matches('.quick-option') ? button.lastElementChild.firstChild : button.firstChild)?.textContent.trim()));
    option?.click();
    return !!option;
  }, { selector, labels });
  const none = ['None', '없음'];
  await hub.wait(() => choose('.quick-popover button.quick-option', none), 'No available alternate Provider');
  await hub.wait(async () => (await hub.dom.state('.quick-feedback button'))
    || (await hub.observations.snapshot(connection)).observation?.selection.agent_id === 'none',
  'Provider change produced neither a continuation nor an effective selection');
  if (!await hub.dom.state('.quick-feedback button')) return 'Runner did not require context release';
  await hub.dom.click('.quick-feedback button');
  await hub.wait(() => choose('.quick-interaction button', none), 'Structured Provider menu unavailable');
  await hub.wait(() => choose('.quick-interaction button', ['No', '아니요', '아니오']), 'Structured release confirmation unavailable');
  await hub.wait(() => choose('.quick-interaction button', ['Back', 'Cancel']), 'Provider menu did not return after cancellation');
  await hub.wait(async () => (await mountedRunner(browser, 'quick-state'))?.quick, 'Cancelled Provider command did not settle');
  assert.equal((await hub.observations.snapshot(connection)).observation.selection.agent_id, agent);
  return 'explicit decline preserved the active Provider';
}

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
  const { terminal } = hub;
  const single = route === 'single-entry';
  const quick = route === 'runner-quick';
  const surface = single ? 'single-entry' : 'runner';
  const canonicalConfig = await visibleConfiguration(browser, connection);
  const quickSettings = quick ? await quickDirect(browser, hub, connection, workRoot, canonicalConfig) : undefined;
  if (!quick) {
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
  }
  const instruction = single
    ? 'Reply HUB_SINGLE_ENTRY_ACCEPTANCE. No tools or file/settings changes.'
    : ['Reply with exactly HUB_LONG_COMPOSER_ACCEPTANCE. Do not use tools, modify files, run commands or change settings.',
      ...Array.from({ length: 24 }, (_, i) => `읽기 전용 확인 ${i + 1}: Korean/English multiline presentation check only.`)].join('\n');
  const compact = presentation ? await geometry(browser) : undefined;
  const retainedLine = presentation && !single
    ? (await terminal.buffer()).full.split('\n').find(line => line.trim()) : undefined;
  await hub.draft(surface, instruction);
  assert.equal((await hub.instructionState(surface)).value, instruction);
  const editing = presentation ? await geometry(browser) : undefined;
  const observedSessions = await browser.execute(() => {
    return Object.keys(window.__wg3Observation.snapshots);
  });
  const priorSnapshots = await Promise.all(observedSessions.map(id => observeSession(browser, id)));
  const priorBySession = new Map(observedSessions.map((id, index) =>
    [id, new Set(workSubmissions(priorSnapshots[index]).map(result => result.id))]));
  await hub.submit(surface);
  const entered = presentation ? await geometry(browser) : undefined;
  connection = await visibleConnection(browser);
  let submitted, completed, instructionPublication;
  const admissionDeadline = performance.now() + startupMs;
  await browser.waitUntil(async () => {
    const snapshot = await hub.observations.snapshot(connection);
    submitted ??= workSubmissions(snapshot).find(r => !priorBySession.get(connection.session)?.has(r.id));
    if (!submitted && performance.now() > admissionDeadline)
      throw new UnverifiedObservation('Original work admission was not observed; do not resubmit');
    if (submitted?.state === 'rejected') throw new BlockedPrerequisite('Read-only work rejected: ' + submitted.code);
    if (submitted?.state === 'outcome-unknown') throw new UnverifiedObservation('Work effect unknown; do not replay');
    completed = submitted && workObservations(snapshot).find(work => work.submission_request_id === submitted.id && work.terminal);
    if (presentation && !instructionPublication) {
      const buffer = await terminal.buffer();
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
      return executionReleased(await hub.observations.snapshot(connection));
    }, 'Completed work did not release its owned execution');
    if (single) await hub.selectSingleEntry();
    assert.equal((await hub.instructionState(surface)).value, '', 'Canonical start clears the originating draft');
    if (quickSettings) {
      const verified = await visibleConfiguration(browser, connection);
      assert.equal(verified.current.run_mode, quickSettings.current.run_mode);
      assert.equal(verified.current.root, quickSettings.current.root);
      const providerConfirmation = await cancelProviderRelease(browser, hub, connection, verified.effective.agent_id);
      return { ...result, executionReleased: true, quickModeAndRootPreserved: true, providerConfirmation };
    }
    return { ...result, executionReleased: true };
  }
  const reply = single ? 'HUB_SINGLE_ENTRY_ACCEPTANCE' : 'HUB_LONG_COMPOSER_ACCEPTANCE';
  await hub.wait(async () => await terminal.find(reply) >= 0, 'Provider reply missing from terminal buffer');
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
    originalInstructionBufferCount = normalize((await terminal.buffer()).full).split(normalize(instruction)).length - 1;
    if (originalInstructionBufferCount !== 1) throw new UnverifiedObservation(
      'Original instruction exact buffer count ' + originalInstructionBufferCount + '; no synthetic echo: '
      + JSON.stringify({ requestId: submitted.id, started: completed.started_event_id, outcome: completed.outcome,
        tab: connection.tab, session: connection.session, generation: connection.generation }));
    assert.equal(originalInstructionBufferCount, 1, 'Original PTY instruction retained');
  }
  let released;
  await browser.waitUntil(async () => {
    const snapshot = await hub.observations.snapshot(connection);
    const observation = snapshot.observation;
    const marker = await browser.execute(tab => {
      const row = [...document.querySelectorAll('.runner-row')].find(r => r.dataset.runnerId === tab);
      const dot = row?.querySelector('.status-dot');
      return dot && { activity: dot.className, label: dot.getAttribute('aria-label'), color: getComputedStyle(dot).color };
    }, connection.tab);
    released = { observation, marker, age: snapshot.observationAgeMs };
    return executionReleased(snapshot) && marker?.activity === 'status-dot idle';
  }, { timeout: startupMs, timeoutMsg: 'Completed work did not produce verified released Idle sidebar authority' });
  assert.equal(released.marker.color, 'rgb(34, 197, 94)');
  assert.equal(released.marker.label, 'Verified idle');
  const buffer = await terminal.buffer(), output = buffer.full;
  const canonical = await terminal.canonicalRecords(connection);
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
  const id = route === 'single-entry' ? 'single-entry-work' : route === 'runner-quick' ? 'quick-settings-work' : 'semantic-work';
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
