import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { BlockedPrerequisite, UnverifiedObservation, defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { pollMs, startupMs, commandMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, stopWatching, visibleConnection } from './runner-flow.mjs';
import { observeConnection } from './runner-observations.mjs';
import { HubActions } from './hub-actions.mjs';

const producerRevision = 'd1aaa67e689d7e5f2fa3139420595b5ca8d4e1e7';
const exactReply = 'Continue the same fixture Discussion.';
const command = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const observed = (stage, value) => console.log(JSON.stringify({ stage, value }));
const running = ['running', 'Running', 'rgb(59, 130, 246)', 'm10 8 6 4-6 4Z'];
const waiting = ['attention', 'IssueRun needs your response or approval', 'rgb(255, 214, 0)', 'M12 7v6m0 4h.01'];
const copyDependencies = `
from importlib.metadata import distribution
from pathlib import Path
from shutil import copytree
import json, sys

target = Path(sys.argv[1])
versions = {}
for name in ("prompt_toolkit", "tzlocal", "tzdata", "wcwidth"):
    package = distribution(name)
    files = package.files or ()
    metadata = next(item.parts[0] for item in files
                    if len(item.parts) == 2 and item.parts[1] == "METADATA")
    for folder in (name, metadata):
        source = Path(package.locate_file(folder))
        copytree(source, target / folder, ignore=lambda _, names: {"__pycache__"} & set(names))
    versions[name] = package.version
print(json.dumps(versions))
`;

async function stageProducer(source, root) {
  if (!source || process.platform !== 'win32') throw new BlockedPrerequisite(
    'The isolated Discussion fixture requires Windows and --producer-source with the accepted local Git object.');
  const opts = { timeout: startupMs, windowsHide: true, env: {
    ...process.env, GIT_CONFIG_GLOBAL: 'NUL', GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file',
  } };
  const archive = path.join(root, 'producer.tar');
  const envRoot = path.join(root, 'local/runtime/python-env');
  await fs.mkdir(path.join(root, 'signals'), { recursive: true });
  try {
    const selection = ['src', 'tests', 'docs', 'resources', '.agent', '.codex', 'AGENTS.md', 'config.json'];
    const located = await command('where.exe', ['git.exe'], opts);
    const git = located.stdout.trim().split(/\r?\n/)[0];
    assert.ok(path.isAbsolute(git));
    await command(git, ['-C', source, 'archive', '-o', archive, producerRevision, ...selection], opts);
    const archiveSha256 = digest(await fs.readFile(archive));
    await command('tar.exe', ['-xf', archive, '-C', root], opts);
    await fs.unlink(archive);
    // Canonical command discovery queries a Git index even in the isolated installation.
    await command(git, ['-C', root, 'init', '-b', 'main', '--template='], opts);
    await command(git, ['-C', root, 'config', 'core.longpaths', 'true'], opts);
    await command(git, ['-C', root, '-c', 'core.autocrlf=false', 'add', '-f', '--', ...selection], opts);
    await fs.writeFile(path.join(root, 'signals/toolchain.json'), JSON.stringify({ git }), { flag: 'wx' });
    await command('python', ['-I', '-m', 'venv', '--without-pip', envRoot], opts);
    const packages = path.join(envRoot, 'Lib/site-packages');
    const dependencies = await command('python', ['-I', '-c', copyDependencies, packages], opts);
    await fs.writeFile(path.join(packages, 'hub-fixture.pth'),
      path.join(root, 'src') + '\n' + root + '\n', { flag: 'wx' });
    const bootstrap = await fs.readFile(new URL('./issue-sidebar-bootstrap.py', import.meta.url));
    // Only the disposable installation's entry-point composition is overlaid.
    await fs.writeFile(path.join(root, 'src/runner/__main__.py'), bootstrap);
    return { revision: producerRevision, archiveSha256, bootstrapSha256: digest(bootstrap),
      installation: root, envRoot, dependencies: JSON.parse(dependencies.stdout) };
  } catch (error) {
    throw new BlockedPrerequisite('Staging the accepted local producer failed: ' + (error.stderr || error.message));
  }
}

async function record(root, name) {
  try { return JSON.parse(await fs.readFile(path.join(root, 'signals', name + '.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

function ownedPath(root, value) {
  const relative = path.relative(root, value);
  return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

async function markerSample(browser, tab) {
  const selector = `[data-runner-id="${tab}"] .status-dot`;
  const appearance = await browser.execute(selector => {
    const dot = document.querySelector(selector);
    if (!dot) return null;
    const style = getComputedStyle(dot);
    const rect = dot.getBoundingClientRect();
    return { state: [...dot.classList], color: style.color, shape: dot.querySelector('path')?.getAttribute('d'),
      visible: !!(rect.width && rect.height && style.visibility === 'visible' && style.display !== 'none') };
  }, selector);
  if (!appearance) return null;
  const marker = await browser.$(selector);
  return { ...appearance, role: await marker.getComputedRole(), label: await marker.getComputedLabel() };
}

function matchesMarker(marker, [state, label, color, shape]) {
  return marker?.visible && marker.state.includes(state) && marker.role === 'img' &&
    marker.label === label && marker.color === color && marker.shape === shape;
}

function feature(browser, connection, request) {
  return browser.execute(({ id, request }) => window.__TAURI_INTERNALS__.invoke('runner_feature',
    { id, request: { feature: 'work', request } }), { id: connection.session, request });
}

async function sample(browser, connection) {
  const current = await observeConnection(browser, connection);
  const { issue_run_user_action: action, issue_run_execution: execution, attention } = current.observation ?? {};
  return { action, execution, attention, serial: current.observationSerial, age: current.observationAgeMs,
    marker: await markerSample(browser, connection.tab) };
}

const matched = s => s.execution?.issue_run_id && s.execution.issue_run_id === s.action?.issue_run_id &&
  s.execution.state_revision === s.action.state_revision;

function live(s) {
  return matched(s) && s.execution.status === 'running' && s.action.status === 'not_required' &&
    s.execution.interpreter?.turn_id && matchesMarker(s.marker, running);
}

function discussion(s, previous, id) {
  return matched(s) && s.execution.issue_run_id === id && s.execution.state_revision > previous &&
    s.execution.status === 'idle' && s.action.status === 'required' &&
    s.action.requirements?.length === 1 && s.action.requirements[0].kind === 'discussion' &&
    matchesMarker(s.marker, waiting);
}

async function waitSample(browser, connection, root, description, predicate) {
  let last, failure;
  await browser.waitUntil(async () => {
    failure = await record(root, 'failure');
    if (failure) return true;
    last = await sample(browser, connection);
    return predicate(last);
  }, { timeout: startupMs, interval: pollMs, timeoutMsg: description }).catch(error => {
    throw new UnverifiedObservation(error.message + ': ' + JSON.stringify(last));
  });
  if (failure) throw new UnverifiedObservation(description + ': ' + failure.error);
  return last;
}

async function workResult(browser, connection, request) {
  const admission = await feature(browser, connection, request);
  assert.equal(admission.state, 'submitted', JSON.stringify(admission));
  assert.equal(admission.generation, connection.generation);
  let receipt;
  await browser.waitUntil(async () => {
    const current = await observeConnection(browser, connection);
    receipt = current.features.results.find(r => r.id === admission.id && r.feature === 'work' &&
      r.operation === request.operation && r.phase === 'completed');
    return !!receipt;
  }, { timeout: commandMs, interval: pollMs, timeoutMsg: 'Missing correlated ' + request.operation + ' receipt' });
  assert.equal(receipt.state, 'accepted', JSON.stringify(receipt));
  return { admission, receipt };
}

async function releasePeer(ready) {
  await fs.writeFile(ready.release, 'release\n', { flag: 'wx' });
}

export function issueSidebarLifecycle(source) {
  let installation, producer, executableSha256;
  return defineNativeCase({
    id: 'issue-sidebar-lifecycle', presentation: 'background',
    async ready(browser, { profile, executable }) {
      installation = path.join(profile, 'issue-sidebar');
      producer = await stageProducer(source, installation);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(executable)) hash.update(chunk);
      executableSha256 = hash.digest('hex');
      await readyInstalledHub(browser, installation);
    },
    async run(browser) {
      let root, ready;
      try {
        const { tabs, terminal } = new HubActions(browser);
        await tabs.add();
        const connection = await visibleConnection(browser, installation);
        let session;
        await browser.waitUntil(async () => {
          const buffer = await terminal.buffer();
          if (buffer.identity.tab !== connection.tab || buffer.identity.session !== connection.session) return false;
          session = /Hub fixture ([a-f0-9]{32})/.exec(buffer.full)?.[1];
          return !!session;
        }, { timeout: commandMs, interval: pollMs, timeoutMsg: 'Missing fixture identity on the exact native PTY' });
        root = path.join(installation, 'children', session);
        const signals = path.join(root, 'signals');
        ready = await record(root, 'ready');
        assert.ok(ready?.pid > 0 && ready.runnerSession === session && ownedPath(installation, producer.envRoot) &&
          [ready.root, ready.remote, ready.release, ready.profile, ready.workspaceLocal,
            ready.workspaceRuns, ready.workspaceGit].every(value => ownedPath(root, value)),
        'Fixture process and disposable effect owners must be known before Work');
        assert.equal(ready.inputOwner, 'InteractiveDiscussionHarness.submit');
        const observation = connection.snapshot.observation;
        assert.equal(observation.run_mode, 'issue-run');
        assert.deepEqual(observation.target, { owner: 'Workspace', project: 'agent-workspace', binding_state: 'bound' });
        assert.equal(observation.issue_run_execution?.status, 'idle');
        assert.equal(observation.issue_run_user_action?.status, 'not_required');
        assert.ok(connection.snapshot.features.work?.operations.includes('work.submit'), 'Canonical Work unavailable');
        const idle = await waitSample(browser, connection, root, 'Verified idle marker', s =>
          s.execution?.status === 'idle' && !s.execution.issue_run_id && s.action?.status === 'not_required' &&
          s.marker?.visible && s.marker.role === 'img' && s.marker.label === 'Verified idle' &&
          s.marker.state.includes('idle'));
        const binding = { tab: connection.tab, session: connection.session, generation: connection.generation };
        observed('before-work', { executableSha256, producer, isolation: ready, binding, idle });

        const initial = await workResult(browser, connection, {
          operation: 'work.submit', api_version: 1, instruction: 'Discuss the fixture goal.',
        });
        const first = await waitSample(browser, connection, root, 'Initial live Interpretation', live);
        const work = await workResult(browser, connection, { operation: 'work.status', api_version: 1,
          submission_request_id: initial.admission.id });
        assert.equal(work.receipt.reply.work.started_event_id, 0, 'Live Interpreter must precede retrospective Work start');
        observed('initial-live', { initial, first, work });
        const id = first.execution.issue_run_id;
        const original = first.execution.interpreter;
        await releasePeer(ready);
        const wait = await waitSample(browser, connection, root, 'Committed ordinary Discussion wait',
          s => discussion(s, first.execution.state_revision, id));
        const gate = { issueRun: id, revision: wait.execution.state_revision, thread: original.thread_id,
          turn: original.turn_id, turnCount: 1 };
        observed('before-reply', { wait, gate });
        // Atomic one-shot delivery of authority only. The bootstrap owns the sole text.
        const staged = path.join(signals, 'reply.tmp');
        await fs.writeFile(staged, JSON.stringify(gate), { flag: 'wx' });
        await fs.rename(staged, path.join(signals, 'reply.json'));
        const resumed = await waitSample(browser, connection, root, 'Renewed live Interpretation', s =>
          live(s) && s.execution.issue_run_id === id && s.execution.state_revision > gate.revision &&
          s.execution.interpreter.thread_id === original.thread_id &&
          s.execution.interpreter.turn_id !== original.turn_id);
        assert.deepEqual(await record(root, 'reply-started'), gate);
        observed('renewed-live', resumed);
        await releasePeer(ready);
        const settled = await waitSample(browser, connection, root, 'New committed Discussion wait',
          s => discussion(s, resumed.execution.state_revision, id));
        let committed;
        await browser.waitUntil(async () => !!(committed = await record(root, 'reply-committed')),
          { timeout: commandMs, interval: pollMs, timeoutMsg: 'Missing canonical committed input' });
        assert.equal(committed.exactText, exactReply);
        assert.equal(committed.inputArtifacts.length, 1);
        assert.equal(committed.issueRun, id);
        assert.equal(committed.revision, settled.execution.state_revision);
        assert.equal(committed.thread, original.thread_id);
        assert.equal(committed.turn, resumed.execution.interpreter.turn_id);
        observed('reply-settled', { committed, settled });
        await fs.writeFile(path.join(signals, 'stop'), '', { flag: 'wx' });
        let closure;
        await browser.waitUntil(async () => !!(closure = await record(root, 'closed')),
          { timeout: commandMs, interval: pollMs, timeoutMsg: 'Fixture Runner did not settle' });
        assert.deepEqual(closure, { pid: ready.pid, runnerStopped: true });
        return { executableSha256, producer, isolation: ready, binding, idle,
          initial, first, work, wait, gate, resumed, committed, settled, closure };
      } finally {
        // Unblock outstanding fixture work before the existing native owner closes its job.
        if (ready && ownedPath(root, ready.release)) {
          await fs.writeFile(ready.release, 'release\n');
          await fs.writeFile(path.join(root, 'signals', 'stop'), '');
        }
        await stopWatching(browser);
      }
    },
  });
}
