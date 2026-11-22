import { BlockedPrerequisite, UnverifiedObservation, defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { pollMs, startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, correlated, readyInstalledHub, stopWatching, visibleConfiguration, visibleConnection } from './runner-flow.mjs';
import { terminalBuffer } from './terminal-buffer.mjs';

const composer = '.runner-composer textarea';
const running = ['running', 'Running', 'rgb(59, 130, 246)', 'm10 8 6 4-6 4Z'];
const waiting = ['attention', 'IssueRun needs your response or approval', 'rgb(255, 214, 0)', 'M12 7v6m0 4h.01'];

async function markerSample(browser, tab) {
  const selector = `[data-runner-id="${tab}"] .status-dot`;
  const marker = await browser.$(selector);
  const appearance = await browser.execute(selector => {
    const dot = document.querySelector(selector);
    if (!dot) return null;
    const style = getComputedStyle(dot), rect = dot.getBoundingClientRect();
    return { state: dot.className, color: style.color, shape: dot.querySelector('path')?.getAttribute('d'),
      visible: !!(rect.width && rect.height && style.visibility === 'visible') };
  }, selector);
  if (!appearance) return null;
  return { ...appearance, role: await marker.getComputedRole(), label: await marker.getComputedLabel() };
}

async function sample(browser, connection) {
  const snapshot = correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke(
    'runner_observe', { id }), connection.session), connection);
  const observation = snapshot.observation;
  const works = (snapshot.features.results ?? []).filter(r => r.feature === 'work')
    .flatMap(r => [r.reply?.work, ...(r.reply?.works ?? [])]).filter(Boolean);
  return { serial: snapshot.observationSerial, age: snapshot.observationAgeMs, mode: observation?.run_mode,
    action: observation?.issue_run_user_action, execution: observation?.issue_run_execution,
    works: works.map(w => ({ request: w.submission_request_id, state: w.state, outcome: w.outcome, code: w.code })),
    workStarted: works.some(w => w.work_id?.kind === 'issue'
      && w.work_id.id === observation?.issue_run_execution?.issue_run_id && w.started_event_id > 0),
    submissions: (snapshot.features.results ?? []).filter(r => r.feature === 'work' && r.operation === 'work.submit')
      .map(({ id, state, code }) => ({ id, state, code })) };
}

async function sendDiscussion(browser, instruction) {
  await browser.waitUntil(() => browser.execute(selector => {
    const input = document.querySelector(selector);
    return input && !input.disabled && !input.readOnly && !input.value;
  }, composer), { timeout: startupMs, timeoutMsg: 'Empty, enabled Discussion composer unavailable' });
  await changeValue(browser, composer, instruction);
  const consumed = await browser.execute(selector => {
    const input = document.querySelector(selector);
    input.focus();
    return !input.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  }, composer);
  if (!consumed) throw new BlockedPrerequisite('The native composer did not consume Enter');
}

async function composerObservation(browser, session) {
  return browser.execute(id => {
    const host = document.querySelector('.terminal-host');
    let fiber = host?.[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    for (; fiber; fiber = fiber.return) {
      const s = fiber.memoizedProps?.session;
      if (s?.control?.sessionId !== id || s.terminal?.element?.parentElement !== host) continue;
      return { mode: s.hubSelections?.defaults.runMode, submitting: !!s.view.submitting,
        draftRetained: !!s.view.draft, detail: s.view.detail?.key ?? null,
        reason: s.view.detail?.values?.reason?.key ?? null,
        configurationError: s.control.config.error?.key ?? null,
        status: s.view.status, exitCode: s.view.exitCode, exitError: s.view.status === 'exited' && !!s.view.detail };
    }
    return null;
  }, session ?? null).catch(() => null);
}

async function closeOwnedRow(browser, connection) {
  await browser.execute(id => window.__TAURI_INTERNALS__.invoke('pty_close', { id }), connection.session);
  let marker, terminal;
  await browser.waitUntil(async () => {
    terminal = await composerObservation(browser, connection.session);
    if (terminal?.status !== 'exited') return false;
    const failed = terminal.exitError || typeof terminal.exitCode === 'number' && terminal.exitCode !== 0;
    marker = await markerSample(browser, connection.tab);
    return marker?.state === (failed ? 'status-dot failed' : 'status-dot unknown')
      && marker.label === (failed ? 'Failed' : 'Status unknown')
      && marker.role === 'img' && marker.visible;
  }, { timeout: startupMs, timeoutMsg: 'Owned Runner closure did not retire the sidebar wait' });
  return { exitCode: terminal.exitCode, exitError: terminal.exitError, marker };
}

export function issueSidebarLifecycle(runnerRoot, project) {
  return defineNativeCase({
    id: 'issue-sidebar-lifecycle', presentation: 'background',
    ready(browser) {
      if (!runnerRoot || !project) throw new BlockedPrerequisite('Select the test-authorized --runner-root and --issue-project');
      return readyInstalledHub(browser, runnerRoot);
    },
    async run(browser) {
      const samples = [];
      let identity, connection, latest, marker;
      try {
        await browser.execute(() => document.querySelector('.add-runner').click());
        connection = await visibleConnection(browser, runnerRoot);
        identity = { session: connection.session, generation: connection.generation, tab: connection.tab };
        latest = await sample(browser, connection);
        marker = await markerSample(browser, connection.tab);
        if (latest.action?.status !== 'not_required' || latest.action?.issue_run_id
          || latest.execution?.status !== 'idle' || latest.execution?.issue_run_id)
          throw new BlockedPrerequisite('Authenticated producer did not establish an unbound, idle Runner');
        const configuration = await visibleConfiguration(browser, connection);
        const account = '.task-panel .account-settings select';
        const accountValue = JSON.stringify(configuration.current.account);
        const mode = '.task-panel .execution-settings select';
        const issue = JSON.stringify('issue-run');
        const selectOption = async (selector, value, name) => {
          await browser.waitUntil(() => browser.execute((selector, value) => {
            const select = document.querySelector(selector);
            return select && !select.disabled && [...select.options].some(o => o.value === value && !o.disabled);
          }, selector, value), { timeout: startupMs, timeoutMsg: 'Verified Hub option unavailable: ' + name });
          await changeValue(browser, selector, value);
          if (!await browser.execute((selector, value) => document.querySelector(selector)?.value === value, selector, value))
            throw new BlockedPrerequisite('Hub did not retain the selected ' + name);
        };
        await selectOption(account, accountValue, 'startup account');
        await selectOption(mode, issue, 'IssueRun mode');
        const target = '.task-panel .execution-settings label:nth-of-type(2) select';
        await selectOption(target, JSON.stringify({ binding_state: 'bound', owner: 'Project', project }), 'Project target');

        async function observe(stage, predicate, [state, label, color, shape], timeout = subagentCompletionMs, afterReply = false) {
          let evidence, unsent = false;
          await browser.waitUntil(async () => {
            latest = await sample(browser, connection);
            if (afterReply && !predicate(latest)) {
              const composer = await composerObservation(browser, connection.session);
              unsent = composer?.detail === 'runtime.entry.unsent' && composer.reason === 'runtime.entry.releaseUnconfirmed';
              if (unsent) return true;
            }
            const indeterminateWait = latest.action?.status === 'required'
              && latest.execution?.status === 'unknown' && latest.execution.state_revision === null;
            if (!predicate(latest) || latest.mode !== 'issue-run' || !latest.action?.issue_run_id
              || latest.execution?.issue_run_id !== latest.action.issue_run_id
              || !indeterminateWait && latest.execution?.state_revision !== latest.action.state_revision) return false;
            marker = await markerSample(browser, connection.tab);
            const after = await sample(browser, connection);
            if (JSON.stringify(after.action) !== JSON.stringify(latest.action)
              || JSON.stringify(after.execution) !== JSON.stringify(latest.execution)
              || after.workStarted !== latest.workStarted) return false;
            if (marker?.state !== `status-dot ${state}` || marker.role !== 'img' || marker.label !== label
              || marker.color !== color || marker.shape !== shape || !marker.visible) return false;
            evidence = { stage, producer: latest, marker };
            return true;
          }, { timeout, interval: pollMs, timeoutMsg: stage + ' not observed on the original Runner row' });
          if (unsent) throw new BlockedPrerequisite('The native composer kept the reply unsent because Runner release was unconfirmed');
          samples.push(evidence);
          return evidence.producer;
        }
        const live = s => s.action?.status === 'not_required' && s.execution?.status === 'running'
          && s.execution.interpreter?.turn_id && s.execution.interpreter?.thread_id
          && s.execution.interpreter?.invocation_id && s.execution.interpreter?.instance_id
          && s.execution.interpreter?.launch_generation > 0;
        const discussion = s => s.action?.status === 'required' && ['idle', 'unknown'].includes(s.execution?.status)
          && s.action.requirements.some(r => r.kind === 'discussion');
        const sameIssueAfter = (s, previous) => s.action?.issue_run_id === previous.action.issue_run_id
          && s.action.state_revision > previous.action.state_revision;
        await sendDiscussion(browser, 'In Discussion, describe how you would check a sidebar icon and its accessible name. Please leave the project files unchanged.');
        const first = await observe('live Interpreter before Work start', s => live(s) && !s.workStarted, running, startupMs);
        const wait = await observe('committed Discussion wait', s => sameIssueAfter(s, first) && discussion(s), waiting, 3 * startupMs);
        await sendDiscussion(browser, 'Still in Discussion, which of those checks would you run first? Please leave the project files unchanged.');
        const renewed = await observe('admitted reply and renewed Interpreter', s => sameIssueAfter(s, wait) && live(s)
          && s.execution.interpreter.turn_id !== first.execution.interpreter.turn_id, running, startupMs, true);
        await observe('renewed Discussion settled', s => sameIssueAfter(s, renewed) && discussion(s), waiting);
        return { identity, samples, disconnected: await closeOwnedRow(browser, connection) };
      } catch (error) {
        const composerState = await composerObservation(browser, identity?.session);
        const currentMarker = identity && await markerSample(browser, identity.tab).catch(() => null);
        const buffer = await terminalBuffer(browser).catch(() => null);
        const failureCodes = buffer && identity && buffer.identity.session === identity.session
          ? [...new Set(buffer.full.match(/\b(?:ISSUE_RUN|RUNNER_NOT_IDLE|TARGET_BINDING_REQUIRED)[A-Z_0-9]*\b/g))] : [];
        // Only a proven unsent reply permits the independent close check here.
        let disconnected;
        if (error instanceof BlockedPrerequisite && connection && samples.at(-1)?.stage === 'committed Discussion wait'
          && !composerState?.submitting
          && composerState?.detail === 'runtime.entry.unsent' && composerState.reason === 'runtime.entry.releaseUnconfirmed') {
          disconnected = await closeOwnedRow(browser, connection).catch(error => ({ error: error.message }));
        }
        const detail = JSON.stringify({ identity, samples, latest, currentMarker, composerState, failureCodes, disconnected });
        if (error instanceof BlockedPrerequisite) throw new BlockedPrerequisite(error.message + ': ' + detail);
        throw new UnverifiedObservation(error.message + ': ' + detail);
      } finally {
        await stopWatching(browser);
      }
    }
  });
}
