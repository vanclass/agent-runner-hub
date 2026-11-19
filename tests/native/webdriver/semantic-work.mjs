import assert from 'node:assert/strict';
import { BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, correlated, visibleConnection, visibleConfiguration } from './runner-flow.mjs';
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
export async function semanticWork(browser, connection, workRoot, route = 'runner') {
  const single = route === 'single-entry';
  if (single) {
    const canonical = await visibleConfiguration(browser, connection);
    await browser.execute(() => document.querySelector('.sidebar > .nav-row, .sidebar .nav-row').click());
    const account = JSON.stringify(canonical.current.account);
    await browser.waitUntil(async () => browser.execute(account => [...document.querySelector(
      '.task-panel .account-settings select').options].some(o => o.value === account), account), { timeout: startupMs });
    await changeValue(browser, '.task-panel .account-settings select', account);
  }
  const inputSelector = single ? '.composer-area textarea[data-instruction]' : '.runner-composer textarea';
  const mode = '.task-panel .execution-settings select';
  await browser.waitUntil(async () => browser.execute(selector => {
    const select = document.querySelector(selector);
    return select && !select.disabled && select.options.length > 1;
  }, mode), { timeout: startupMs, timeoutMsg: 'Requested mode catalog did not settle after account selection' });
  const supported = await browser.execute(selector => [...document.querySelector(selector).options]
    .some(option => option.value === JSON.stringify('pure-direct-run') && !option.disabled), mode);
  if (!supported) throw new BlockedPrerequisite('Installed Runner does not offer Pure Direct for isolated semantic work acceptance');
  await changeValue(browser, mode, JSON.stringify('pure-direct-run'));
  await changeValue(browser, '.task-panel .directory-input input', workRoot);
  const instruction = single
    ? 'Reply HUB_SINGLE_ENTRY_ACCEPTANCE. No tools or file/settings changes.'
    : ['Reply with exactly HUB_LONG_COMPOSER_ACCEPTANCE. Do not use tools, modify files, run commands or change settings.',
      ...Array.from({ length: 24 }, (_, i) => `읽기 전용 확인 ${i + 1}: Korean/English multiline presentation check only.`)].join('\n');
  await browser.waitUntil(async () => browser.execute(selector => {
    const input = document.querySelector(selector); return input && !input.disabled && !input.readOnly;
  }, inputSelector), { timeout: startupMs });
  const compact = await geometry(browser);
  const retainedLine = single ? undefined : (await terminalBuffer(browser)).full.split('\n').find(line => line.trim());
  await changeValue(browser, inputSelector, instruction);
  const editing = await geometry(browser);
  const previousRequests = await browser.execute(async () => {
    return (await Promise.all(Object.keys(window.__wg3Observation.snapshots).map(async id =>
      window.__TAURI_INTERNALS__.invoke('runner_observe', { id })))).flatMap(s => s.features?.results ?? [])
      .filter(r => r.feature === 'work' && r.operation === 'work.submit').map(r => r.id);
  });
  const pendingDelivery = await browser.execute(selector => {
    const input = document.querySelector(selector);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { draftLength: input.value.length, height: input.getBoundingClientRect().height,
      disabled: input.disabled, rows: input.rows };
  }, inputSelector);
  const entered = await geometry(browser);
  connection = await visibleConnection(browser);
  let submitted, completed, instructionPublication;
  await browser.waitUntil(async () => {
    const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
    submitted ??= snapshot.features.results.find(r => r.feature === 'work' && r.operation === 'work.submit'
      && !previousRequests.includes(r.id));
    if (submitted?.state === 'rejected') throw new BlockedPrerequisite('Read-only work rejected: ' + submitted.code);
    if (submitted?.state === 'outcome-unknown') throw new UnverifiedObservation('Work effect unknown; do not replay');
    const observations = snapshot.features.results.filter(r => r.feature === 'work').flatMap(r => [r.reply?.work, ...(r.reply?.works ?? [])]).filter(Boolean);
    completed = observations.find(work => work.submission_request_id === submitted?.id && work.terminal);
    if (!instructionPublication) {
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
    geometry: { compact, editing, pendingDelivery, entered, confirmed }, instructionPublication,
    scrollback,
    accountAndModel: 'inherited from verified canonical startup configuration' };
}
