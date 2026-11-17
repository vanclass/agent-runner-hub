import assert from 'node:assert/strict';
import { BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, correlated, visibleConnection, visibleConfiguration } from './runner-flow.mjs';

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
  const retainedLine = await browser.execute(() => [...document.querySelectorAll('.xterm-rows > div')]
    .map(line => line.textContent.trim()).find(Boolean));
  await changeValue(browser, inputSelector, instruction);
  const editing = await geometry(browser);
  const previousRequests = await browser.execute(async () => {
    return (await Promise.all(Object.keys(window.__wg3Observation.snapshots).map(async id =>
      window.__TAURI_INTERNALS__.invoke('runner_observe', { id })))).flatMap(s => s.features?.results ?? [])
      .filter(r => r.feature === 'work' && r.operation === 'work.submit').map(r => r.id);
  });
  await browser.execute(selector => {
    const input = document.querySelector(selector);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }, inputSelector);
  const entered = await geometry(browser);
  connection = await visibleConnection(browser);
  let submitted, completed;
  await browser.waitUntil(async () => {
    const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
    submitted ??= snapshot.features.results.find(r => r.feature === 'work' && r.operation === 'work.submit'
      && !previousRequests.includes(r.id));
    if (submitted?.state === 'rejected') throw new BlockedPrerequisite('Read-only work rejected: ' + submitted.code);
    if (submitted?.state === 'outcome-unknown') throw new UnverifiedObservation('Work effect unknown; do not replay');
    const observations = snapshot.features.results.filter(r => r.feature === 'work').flatMap(r => [r.reply?.work, ...(r.reply?.works ?? [])]).filter(Boolean);
    completed = observations.find(work => work.submission_request_id === submitted?.id && work.terminal);
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
  await browser.waitUntil(async () => browser.execute(reply => document.querySelector('.xterm-rows')
    ?.textContent.includes(reply), reply), { timeout: startupMs });
  const confirmed = await geometry(browser);
  assert.equal(confirmed.draftLength, 0, 'Canonical start clears the unchanged draft');
  if (!single) {
    assert.ok(editing.input.height > compact.input.height, 'Long editing expands');
    assert.ok(entered.input.height < editing.input.height, 'Enter compacts');
    assert.ok(entered.input.top >= entered.terminal.bottom, 'Composer does not cover output');
  }
  let originalInstructionBufferCount;
  if (single) {
    originalInstructionBufferCount = await browser.execute(instruction => {
      const host = document.querySelector('.terminal-host');
      let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
      for (; fiber; fiber = fiber.return) {
        const terminal = fiber.memoizedProps?.session?.terminal;
        if (terminal?.element?.parentElement !== host) continue;
        const buffer = terminal.buffer.active;
        const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString());
        const matches = lines.flatMap((line, i) => line.includes(instruction) ? [i] : []);
        if (matches.length) terminal.scrollToLine(matches[0]);
        return matches.length;
      }
    }, instruction);
    if (originalInstructionBufferCount !== 1) throw new UnverifiedObservation(
      'Original instruction exact buffer count ' + originalInstructionBufferCount + '; no synthetic echo: '
      + JSON.stringify({ requestId: submitted.id, started: completed.started_event_id, outcome: completed.outcome,
        tab: connection.tab, session: connection.session, generation: connection.generation }));
    await browser.waitUntil(async () => browser.execute(instruction => document.querySelector('.xterm-rows')
      .textContent.includes(instruction), instruction), { timeout: startupMs,
      timeoutMsg: 'Original instruction unavailable in actual xterm scrollback; no synthetic echo' });
  }
  const output = await browser.execute(() => document.querySelector('.xterm-rows').textContent);
  const scrollback = await browser.execute(retainedLine => {
    const host = document.querySelector('.terminal-host');
    let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    for (; fiber; fiber = fiber.return) {
      const terminal = fiber.memoizedProps?.session?.terminal;
      if (terminal?.element?.parentElement !== host) continue;
      const buffer = terminal.buffer.active;
      return { lines: buffer.length, baseY: buffer.baseY,
        startupRetained: Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString())
          .some(line => !!retainedLine && line.includes(retainedLine)) };
    }
    return null;
  }, retainedLine);
  if (!single) assert.ok(scrollback?.startupRetained, 'Original startup scrollback retained');
  const normalize = text => text.replace(/\s/g, '');
  const count = normalize(output).split(normalize(instruction)).length - 1;
  if (single) assert.equal(count, 1, 'Original Single Entry instruction appears once in visible xterm: '
    + JSON.stringify({ requestId: submitted.id, started: completed.started_event_id, outcome: completed.outcome,
      identity: { tab: connection.tab, session: connection.session, generation: connection.generation },
      matchingRows: output.split('\n').filter(line => /Reply|HUB_SINGLE|tools|changes/.test(line)) }));
  return { originalRequestId: submitted.id, started: completed.started_event_id > 0, outcome: completed.outcome,
    ptyReplyObserved: true, instructionCount: single ? count : undefined,
    originalInstructionBufferCount,
    identity: { tab: connection.tab, session: connection.session, generation: connection.generation },
    geometry: { compact, editing, entered, confirmed },
    scrollback,
    accountAndModel: 'inherited from verified canonical startup configuration' };
}
