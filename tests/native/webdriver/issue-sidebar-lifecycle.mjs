import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { BlockedPrerequisite, UnverifiedObservation, defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { pollMs, startupMs, subagentCompletionMs } from '../../../tools/native-probe/limits.mjs';
import { changeValue, correlated, readyInstalledHub, stopWatching, visibleConfiguration, visibleConnection } from './runner-flow.mjs';
import { terminalBuffer } from './terminal-buffer.mjs';

const composer = '.runner-composer textarea';
const running = ['running', 'Running', 'rgb(59, 130, 246)', 'm10 8 6 4-6 4Z'];
const waiting = ['attention', 'IssueRun needs your response or approval', 'rgb(255, 214, 0)', 'M12 7v6m0 4h.01'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const repoGit = (directory, ...args) => execFileSync('git', ['-C', directory, ...args],
  { encoding: 'utf8', timeout: 10_000 }).trim();
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
};

async function isolatedEffects(root, runnerRoot, project) {
  const installation = await realpath(runnerRoot);
  const sandbox = await realpath(path.join(root, 'temp'));
  if (!inside(sandbox, installation)) return null;
  const registry = JSON.parse(await readFile(path.join(installation, 'local/config/projects.json'), 'utf8'));
  const location = registry.projects?.[project]?.project_root;
  if (!location || !path.isAbsolute(location)) return null;
  const projectRoot = await realpath(location);
  if (!inside(sandbox, projectRoot) || projectRoot === installation
    || repoGit(installation, 'remote') || repoGit(projectRoot, 'remote')) return null;
  for (const checkout of [installation, projectRoot]) {
    const common = repoGit(checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    if (!inside(checkout, await realpath(common))
      || await realpath(repoGit(checkout, 'rev-parse', '--show-toplevel')) !== checkout) return null;
  }
  return { installation, projectRoot, stop: 'fixture-owned native /abort followed by native-owner teardown' };
}
const assetDigests = browser => browser.execute(async () => {
  const assets = [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
    .map(node => new URL(node.src || node.href));
  if (!assets.some(asset => asset.pathname.endsWith('.js')) || !crypto.subtle)
    throw new Error('Mounted Candidate asset identity unavailable');
  return Promise.all(assets.map(async asset => {
    if (asset.origin !== location.origin) throw new Error('Unexpected Candidate asset origin');
    const response = await fetch(asset);
    if (!response.ok) throw new Error('Cannot read mounted Candidate asset ' + asset.pathname);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return { path: asset.pathname, sha256: [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0')).join('') };
  }));
});

// Read only immutable inputs and completed response artifacts from the fresh
// IssueRun identified through this fixture's authenticated connection.
const readDiscussion = `
import hashlib, json, sys
from pathlib import Path
from runner.storage import RunnerStoragePaths
root, issue = Path(sys.argv[1]), sys.argv[2]
artifacts = RunnerStoragePaths(root).resolve_issue_run_root(issue) / 'artifacts'
def read(folder, fields):
    files = sorted(folder.glob('*.json'))
    assert len(files) <= 4, 'Expected only the fresh fixture Discussion'
    out = []
    for file in files:
        data = json.loads(file.read_bytes())
        if data.get('issue_run_id') != issue or not data.get('sequence'):
            continue
        result = {key: data[key] for key in fields}
        if 'prompt' in data:
            result['text_sha256'] = hashlib.sha256(data['prompt'].encode()).hexdigest()
        out.append({**result, 'path': file.as_posix()})
    return out
print(json.dumps(dict(
    inputs=read(artifacts / 'discussion' / 'inputs', ('sequence', 'action_id', 'prompt_digest')),
    responses=read(artifacts / 'discussion' / 'responses', ('sequence', 'action_id', 'thread_id', 'turn_id')),
    briefs_exist=any((artifacts / 'brief' / 'inputs').glob('*.json')))))
`;
function discussionArtifacts(runnerRoot, id) {
  if (!/^ir-[1-9][0-9]*$/.test(id)) throw new UnverifiedObservation('Unexpected fixture IssueRun identity');
  const python = path.join(runnerRoot, 'local/runtime/python-env/Scripts/python.exe');
  return JSON.parse(execFileSync(python, ['-B', '-X', 'utf8', '-c', readDiscussion, runnerRoot, id], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, PYTHONPATH: path.join(runnerRoot, 'src') }
  }));
}

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
  const commands = entries => entries.flatMap(command => [command, ...commands(command.children ?? [])]);
  return { serial: snapshot.observationSerial, age: snapshot.observationAgeMs, mode: observation?.run_mode,
    target: observation?.target, runnerRoot: snapshot.features.runnerRoot, run: snapshot.features.run,
    commands: commands(observation?.commands ?? []).filter(c => ['/run', '/abort'].includes(c.text))
      .map(({ text, enabled, visible }) => ({ text, enabled, visible })),
    action: observation?.issue_run_user_action, execution: observation?.issue_run_execution,
    works: works.map(w => ({ request: w.submission_request_id, state: w.state, outcome: w.outcome, code: w.code })),
    workStarted: works.some(w => w.work_id?.kind === 'issue'
      && w.work_id.id === observation?.issue_run_execution?.issue_run_id && w.started_event_id > 0),
    submissions: (snapshot.features.results ?? []).filter(r => r.feature === 'work' && r.operation === 'work.submit')
      .map(({ id, state, code }) => ({ id, state, code })),
    runReceipts: snapshot.features.results.filter(r => r.feature === 'run'),
    briefRequests: snapshot.features.results.filter(r => r.feature === 'brief').map(r => r.operation) };
}

function nativeFeature(browser, connection, request) {
  return browser.execute(({ id, request }) => window.__TAURI_INTERNALS__.invoke('runner_feature',
    { id, request: { feature: 'run', request } }), { id: connection.session, request });
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

export function issueSidebarLifecycle(runnerRoot, project, { root, target: targetDir, producerRevision } = {}) {
  return defineNativeCase({
    id: 'issue-sidebar-lifecycle', presentation: 'background',
    ready(browser) {
      if (!runnerRoot || !project) throw new BlockedPrerequisite('Select the test-authorized --runner-root and --issue-project');
      return readyInstalledHub(browser, runnerRoot);
    },
    async run(browser) {
      const samples = [];
      let identity, connection, latest, marker, build, readiness, admission, receipt, committed, settlement, disconnected;
      try {
        const installedRevision = repoGit(runnerRoot, 'rev-parse', 'HEAD');
        if (!producerRevision || installedRevision !== producerRevision
          || repoGit(runnerRoot, 'status', '--porcelain', '--', 'src/runner')) {
          throw new BlockedPrerequisite('Installed Runner source differs from the specified accepted producer');
        }
        const executable = path.join(targetDir, 'x86_64-pc-windows-msvc/debug/web-app-native.exe');
        build = { hubRevision: repoGit(root, 'rev-parse', 'HEAD'), executable,
          executableSha256: sha256(await readFile(executable)), assets: await assetDigests(browser), installedRevision };
        await browser.execute(() => document.querySelector('.add-runner').click());
        connection = await visibleConnection(browser, runnerRoot);
        identity = { session: connection.session, generation: connection.generation, tab: connection.tab };
        latest = await sample(browser, connection);
        marker = await markerSample(browser, connection.tab);
        if (latest.action?.status !== 'not_required' || latest.action?.issue_run_id
          || latest.execution?.status !== 'idle' || latest.execution?.issue_run_id)
          throw new BlockedPrerequisite('Authenticated producer did not establish an unbound, idle Runner');
        await browser.waitUntil(async () => {
          marker = await markerSample(browser, connection.tab);
          return marker?.state === 'status-dot idle' && marker.role === 'img'
            && marker.label === 'Verified idle' && marker.visible;
        }, { timeout: startupMs, interval: pollMs, timeoutMsg: 'Verified idle marker unavailable on the owned row' });
        samples.push({ stage: 'authenticated unbound idle', producer: latest, marker });
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

        async function observe(stage, predicate, [state, label, color, shape], timeout = subagentCompletionMs) {
          let evidence;
          await browser.waitUntil(async () => {
            latest = await sample(browser, connection);
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
        const initialText = 'Disposable read-only sidebar verification ' + randomUUID()
          + '. Discuss how to compare the sidebar icon and accessible name. Ask which check to explain further.'
          + ' Do not change files, settings or repositories, use external tools, or approve or implement work.';
        await sendDiscussion(browser, initialText);
        const first = await observe('live Interpreter before Work start', s => live(s) && !s.workStarted, running, startupMs);
        const wait = await observe('committed Discussion wait', s => sameIssueAfter(s, first) && discussion(s), waiting, 3 * startupMs);
        const issueId = wait.action.issue_run_id;
        const prior = discussionArtifacts(runnerRoot, issueId);
        const firstInput = prior.inputs[0], firstResponse = prior.responses[0];
        const effects = await isolatedEffects(root, runnerRoot, project);
        if (!effects) {
          disconnected = await closeOwnedRow(browser, connection);
          throw new BlockedPrerequisite('The bound installation uses shared project or SCM state. Post-Discussion Run can begin work, so the reply requires an isolated installation and registered disposable target.');
        }
        const fresh = await sample(browser, connection);
        const selectedRow = await browser.execute(({ tab, id }) => {
          const host = document.querySelector('.terminal-host');
          if (!host || document.querySelector('.runner-row.active')?.dataset.runnerId !== tab) return false;
          let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
          for (; fiber; fiber = fiber.return) {
            const session = fiber.memoizedProps?.session;
            if (session?.view.id === tab && session.terminal?.element?.parentElement === host) {
              return session.control.sessionId === id && session.control.observationFresh;
            }
          }
          return false;
        }, { tab: connection.tab, id: connection.session });
        if (!selectedRow || !discussion(fresh) || fresh.action.issue_run_id !== issueId
          || fresh.action.state_revision !== wait.action.state_revision || fresh.execution.issue_run_id !== issueId
          || fresh.target?.owner !== 'Project' || fresh.target.project !== project || fresh.target.binding_state !== 'bound'
          || fresh.run?.version !== 1 || !['run.invoke', 'run.status'].every(op => fresh.run.operations.includes(op))
          || !['/run', '/abort'].every(name => fresh.commands?.some(c => c.text === name && c.visible && c.enabled))
          || fresh.runReceipts.length || fresh.briefRequests.some(op => op === 'brief.stage') || prior.briefs_exist
          || fresh.submissions.length !== 1 || prior.inputs.length !== 1 || prior.responses.length !== 1
          || firstInput.text_sha256 !== sha256(initialText) || firstInput.action_id !== firstResponse.action_id
          || firstResponse.thread_id !== first.execution.interpreter.thread_id
          || firstResponse.turn_id !== first.execution.interpreter.turn_id) {
          throw new BlockedPrerequisite('Fresh native Run gate did not establish the matching owned Discussion, target, capability, and empty Brief history');
        }
        readiness = { issueId, target: fresh.target, revision: fresh.action.state_revision,
          session: connection.session, generation: connection.generation, prior: firstResponse,
          capability: fresh.run, initialRequest: fresh.submissions[0], noBriefs: true,
          effectBoundary: effects };
        const text = 'Read-only sidebar verification reply ' + randomUUID()
          + '. Please explain the accessible-name check in one sentence, then ask one more question.'
          + ' Do not change files, settings or repositories, use external tools, or approve or implement work.';
        readiness.replySha256 = sha256(text);
        admission = await nativeFeature(browser, connection, { operation: 'run.invoke', api_version: 1, text });
        if (admission?.state !== 'submitted' || !Number.isSafeInteger(admission.id)
          || admission.generation !== connection.generation) {
          throw new UnverifiedObservation('Native Run dispatch did not return an exact generation-bound request ID');
        }
        const renewed = await observe('committed wait retired and successor Interpreter live', s => {
          receipt ??= s.runReceipts.find(r => r.id === admission.id && r.operation === 'run.invoke'
            && r.state === 'accepted' && r.reply?.receipt === 'request_accepted'
            && r.reply.run?.invocation_request_id === admission.id);
          const interpreter = s.execution?.interpreter;
          return sameIssueAfter(s, wait) && live(s) && interpreter.thread_id === firstResponse.thread_id
            && interpreter.turn_id !== firstResponse.turn_id;
        }, running, startupMs);
        await observe('post-reply genuine user wait', s => sameIssueAfter(s, renewed)
          && s.action.status === 'required' && s.execution?.status !== 'running', waiting);
        const second = discussionArtifacts(runnerRoot, issueId);
        const input = second.inputs.find(i => i.sequence === 2 && i.text_sha256 === readiness.replySha256
          && i.prompt_digest === readiness.replySha256);
        const response = second.responses.find(r => r.sequence === 2 && r.action_id === input?.action_id
          && r.thread_id === renewed.execution.interpreter.thread_id
          && r.turn_id === renewed.execution.interpreter.turn_id);
        if (!input || !response || second.briefs_exist) {
          throw new UnverifiedObservation('Exact native reply did not correlate to an independently retained Discussion response');
        }
        committed = { input, response };
        if (!receipt) throw new UnverifiedObservation('Authenticated Run acceptance receipt is missing');
        await browser.waitUntil(async () => {
          const status = await nativeFeature(browser, connection, { operation: 'run.status', api_version: 1,
            invocation_request_id: admission.id });
          if (status?.state !== 'submitted' || status.generation !== connection.generation) return false;
          let reply;
          await browser.waitUntil(async () => {
            const current = await sample(browser, connection);
            reply = current.runReceipts.find(r => r.id === status.id && r.operation === 'run.status'
              && ['accepted', 'rejected', 'failure', 'outcome-unknown'].includes(r.state));
            return !!reply;
          }, { timeout: startupMs, interval: pollMs, timeoutMsg: 'Authenticated Run status response unavailable' });
          const run = reply.reply?.run;
          if (reply.state !== 'accepted' || run?.outcome_unknown || run?.invocation_request_id !== admission.id)
            throw new UnverifiedObservation('Run status could not settle the exact invocation');
          if (run.dispatch_status !== 'returned') return false;
          if (run.issue_run_id && run.issue_run_id !== issueId)
            throw new UnverifiedObservation('Run settled on a different IssueRun identity');
          settlement = run;
          return true;
        }, { timeout: startupMs, interval: pollMs, timeoutMsg: 'Owned Run dispatch did not return after the genuine wait' });
        disconnected = await closeOwnedRow(browser, connection);
        return { identity, build, readiness, admission, receipt, committed, settlement, samples, disconnected };
      } catch (error) {
        const composerState = await composerObservation(browser, identity?.session);
        const currentMarker = identity && await markerSample(browser, identity.tab).catch(() => null);
        const buffer = await terminalBuffer(browser).catch(() => null);
        const failureCodes = buffer && identity && buffer.identity.session === identity.session
          ? [...new Set(buffer.full.match(/\b(?:ISSUE_RUN|RUNNER_NOT_IDLE|TARGET_BINDING_REQUIRED)[A-Z_0-9]*\b/g))] : [];
        let stop;
        if (readiness && !settlement) {
          try {
            const current = await sample(browser, connection);
            if (current.action?.issue_run_id === readiness.issueId
              && current.commands.some(c => c.text === '/abort' && c.visible && c.enabled)) {
              stop = await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_command',
                { id, command: '/abort' }), connection.session);
            }
          } catch (error) { stop = { error: error.message }; }
        }
        const detail = JSON.stringify({ identity, build, readiness, admission, receipt, committed, settlement,
          samples, latest, currentMarker, composerState, failureCodes, disconnected, stop });
        if (error instanceof BlockedPrerequisite) throw new BlockedPrerequisite(error.message + ': ' + detail);
        throw new UnverifiedObservation(error.message + ': ' + detail);
      } finally {
        await stopWatching(browser);
      }
    }
  });
}
