import assert from 'node:assert/strict';
import { BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, correlated } from './runner-flow.mjs';

// One explicit harmless Provider instruction; inherit the verified startup account/model.
export async function semanticWork(browser, connection, workRoot) {
  const mode = '.task-panel .execution-settings select';
  const supported = await browser.execute(selector => [...document.querySelector(selector).options]
    .some(option => option.value === JSON.stringify('pure-direct-run') && !option.disabled), mode);
  if (!supported) throw new BlockedPrerequisite('Installed Runner does not offer Pure Direct for isolated semantic work acceptance');
  await changeValue(browser, mode, JSON.stringify('pure-direct-run'));
  await changeValue(browser, '.task-panel .directory-input input', workRoot);
  const instruction = 'Reply with exactly HUB_PRESENTATION_ACCEPTANCE. Do not modify files, use tools, run commands, or change settings. This is one read-only Hub presentation acceptance check.';
  await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.runner-composer textarea')?.disabled), { timeout: startupMs });
  await changeValue(browser, '.runner-composer textarea', instruction);
  await browser.execute(() => {
    const input = document.querySelector('.runner-composer textarea');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  });
  let submitted, completed, activityObserved = false, maxActivityRows = 0;
  await browser.waitUntil(async () => {
    const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
    submitted ??= snapshot.features.results.find(r => r.feature === 'work' && r.operation === 'work.submit');
    const observations = snapshot.features.results.filter(r => r.feature === 'work').flatMap(r => [r.reply?.work, ...(r.reply?.works ?? [])]).filter(Boolean);
    completed = observations.find(work => work.submission_request_id === submitted?.id && work.terminal);
    const rows = await browser.execute(() => document.querySelectorAll('.semantic-activity').length);
    activityObserved ||= rows > 0; maxActivityRows = Math.max(maxActivityRows, rows);
    return !!completed;
  }, { timeout: subagentCompletionMs, timeoutMsg: 'Original work completion unverified; do not resubmit' }).catch(error => {
    throw new UnverifiedObservation(error.message);
  });
  assert.ok(submitted && completed.started_event_id > 0, 'Canonical work start must be observed');
  assert.equal(completed.outcome, 'succeeded', 'Actual read-only Provider work must succeed');
  await browser.waitUntil(async () => browser.execute(() => document.querySelector('.semantic-logs')?.textContent.includes('HUB_PRESENTATION_ACCEPTANCE')), { timeout: startupMs });
  return { originalRequestId: submitted.id, started: completed.started_event_id > 0, outcome: completed.outcome,
    semanticReplyObserved: true, activityObserved, maxActivityRows, instructionCount: 1,
    accountAndModel: 'inherited from verified canonical startup configuration' };
}
