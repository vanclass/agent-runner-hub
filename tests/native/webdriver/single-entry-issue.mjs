import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PNG } from 'pngjs';
import { BlockedPrerequisite, UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { readyInstalledHub, ownedConnection, visibleConnection, correlated } from './runner-flow.mjs';
import { HubActions } from './hub-actions.mjs';

const input = 'textarea[data-instruction]';
const png = [...PNG.sync.write({width: 1, height: 1, data: Buffer.from([31,87,201,255])})];
const wait = (browser, action, label, timeout = 60000) =>
  browser.waitUntil(action, { timeout, interval: 200, timeoutMsg: label });
const snapshot = (browser, connection) => browser.execute(id =>
  window.__TAURI_INTERNALS__.invoke('runner_observe', {id}), connection.session)
  .then(value => correlated(value, connection));

const readInputs = `
import hashlib, json, sys
from pathlib import Path
from runner.issue_run.references import bundles
from runner.storage import RunnerStoragePaths
repo, issue, kind, authority = Path(sys.argv[1]), *sys.argv[2:]
root = RunnerStoragePaths(repo).resolve_issue_run_root(issue)
paths = sorted((root / 'artifacts' / kind / 'inputs').glob('*.json'))
assert len(paths) <= 4, 'Probe must read only its own single-submission workload'
records = []
for file in paths:
    raw = file.read_bytes()
    data = json.loads(raw)
    assert data['issue_run_id'] == issue
    assert data['schema_version'] == ('issue-run-brief-input-v2' if kind == 'brief' else 'issue-run-discussion-input-v2')
    body = [item['body'] for item in data['entries']] if kind == 'brief' else [data['prompt']]
    binding = data['reference_bundle']
    delivery = bundles(root).delivery(binding['bundle_id'], expected_sha256=binding['sha256'])
    records.append(dict(bodies=body, referenceIds=[item.reference.reference_id for item in delivery],
                        artifact=file.as_posix(), sha256=hashlib.sha256(raw).hexdigest(), bundle=binding,
                        actionId=data.get('action_id')))
if kind == 'brief':
    assert len(records) == 1
    files = sorted((root / 'artifacts' / 'lifecycle' / 'shoot').glob('*.json'))
    assert len(files) == 1
    raw = files[0].read_bytes()
    assert hashlib.sha256(raw).hexdigest() == authority
    grant = json.loads(raw)
    assert (grant['schema_version'], grant['issue_run_id'], grant['source']) == (
        'issue-run-shoot-authority-v1', issue, 'run')
    assert grant['brief_inputs'] == [{'name': 'brief_input:' + paths[0].stem, 'sha256': records[0]['sha256']}]
    records[0]['initiationAuthority'] = {'path': files[0].as_posix(), 'sha256': authority}
print(json.dumps(records))
`;

function acceptedInputs(runnerRoot, issue, brief, authority = '') {
  if (!/^ir-[1-9][0-9]*$/.test(issue)) throw new UnverifiedObservation('Invalid native test IssueRun identity');
  const python = path.join(runnerRoot, 'local/runtime/python-env/Scripts/python.exe');
  return JSON.parse(execFileSync(python, ['-B', '-X', 'utf8', '-c', readInputs,
    runnerRoot, issue, brief ? 'brief' : 'discussion', authority], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, PYTHONPATH: path.join(runnerRoot, 'src') }
  }));
}

export function singleEntryIssueCase(runnerRoot, project, brief) {
  return {
    id: brief ? 'native-single-entry-delayed-brief' : 'native-single-entry-issue-work',
    presentation: 'background',
    ready: browser => {
      if (!runnerRoot || !project) throw new BlockedPrerequisite('Select the Runner installation and the exact authorized IssueRun probe target');
      return readyInstalledHub(browser, runnerRoot);
    },
    async run(browser) {
      const hub = new HubActions(browser);
      const body = (brief ? 'Brief' : 'Work') + ' Windows acceptance ' + randomUUID() + '. Describe the attached one-pixel image in one sentence. Make no file, code, repository, or setting changes. Do not use tools. Ask me to confirm before any implementation. Do not publish or modify anything.';
      const initial = await ownedConnection(browser, runnerRoot);
      let account;
      await wait(browser, async () => {
        account = await browser.execute(input => {
          const element = document.querySelector(input);
          let fiber = element?.[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
          for (; fiber && !fiber.memoizedProps?.entry; fiber = fiber.return) {}
          return fiber?.memoizedProps.entry.catalog?.inspection.current.account ?? null;
        }, input);
        return !!account;
      }, 'Verified current startup account is unavailable to Single Entry');
      await hub.selectProviderAccount(account.agent_id, account);
      const supports = initial.snapshot.features;
      if (brief ? !supports.run?.operations?.includes('run.status') || !supports.brief?.operations?.includes('brief.stage')
        : !supports.work?.operations?.includes('work.submit')) {
        // IssueRun-specific capabilities can appear after configuration. Check again at the destination.
        console.log('Startup mode gates feature capability:', initial.snapshot.observation.run_mode);
      }
      await hub.edit('mode', 'issue-run').catch(error => { throw new BlockedPrerequisite(error.message); });
      const requestedTarget = (await hub.field('target'))?.options.find(({ value, disabled }) =>
        !disabled && value?.binding_state === 'bound' && value.owner === 'Project' && value.project === project)?.value;
      if (!requestedTarget) throw new BlockedPrerequisite('Exact IssueRun probe target was absent from the startup Runner catalog');
      await hub.edit('target', requestedTarget);
      await hub.draft('single-entry', body);
      await hub.attachments.pasteImage('single-entry', { bytes: png, name: 'native-acceptance.png', type: 'image/png' });
      await wait(browser, async () => (await hub.attachments.inventory('single-entry'))?.items.length === 1,
        'Single Entry image card unavailable');
      await browser.execute(({ input, brief }) => {
        const element = document.querySelector(input);
        let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
        for (; fiber && !fiber.memoizedProps?.entry; fiber = fiber.return) {}
        const entry = fiber?.memoizedProps.entry;
        if (!entry) throw new Error('Failed to bind originating entry');
        const trace = window.__entryProbe = { entry, settlement: null, lastLive: null, held: [], invoked: [], restore: () => {} };
        const changed = entry.changed, observeEntry = entry.observe;
        const sample = () => {
          const control = trace.session?.control;
          const snapshot = control?.snapshot;
          return { activity: control?.observationFresh ? snapshot?.observation?.issue_run_execution : null,
            serial: snapshot?.observationSerial, session: control?.sessionId, generation: snapshot?.features?.generation,
            draft: entry.draft, cards: entry.attachments.candidates.filter(card => !card.submitted).map(card => card.key),
            work: control?.work.current?.work, brief: control?.brief.result?.initiation };
        };
        const noteSettlement = () => {
          const current = sample();
          if (entry.phase !== 'delivered' && current.activity?.status === 'running') trace.lastLive = current;
          if (!trace.settlement && entry.phase === 'delivered') trace.settlement = current;
        };
        entry.changed = () => { noteSettlement(); return changed(); };
        entry.observe = function () {
          noteSettlement();
          const value = observeEntry.call(this);
          noteSettlement();
          return value;
        };
        if (brief) {
          // Install only after allocation and before the configured admission callback.
          Object.defineProperty(entry, 'active', { configurable: true, get: () => trace.active, set(active) {
            trace.active = active;
            if (!active || trace.session) return;
            trace.session = active.session;
            const owner = active.session.control.brief, observe = owner.observe, run = owner.port.run;
            owner.observe = function (snapshot) {
              const held = snapshot.features?.results.filter(result => result.operation === 'run.status');
              if (held?.length && !trace.release) {
                trace.held = held.map(result => result.id);
                return observe.call(this, { ...snapshot, features: { ...snapshot.features,
                  results: snapshot.features.results.filter(result => result.operation !== 'run.status') } });
              }
              return observe.call(this, snapshot);
            };
            owner.port.run = async (...args) => {
              const admission = await run(...args);
              // Bound only the initial observation wait inside this owned WebView.
              // The actual Run and read-only status requests still use normal native IPC.
              if (args[1].operation === 'run.invoke') owner.port.completionMs = 4_000;
              trace.invoked.push({ request: args[1], admission });
              return admission;
            };
            trace.restore = () => { owner.observe = observe; owner.port.run = run; };
          }});
        } else {
          Object.defineProperty(entry, 'active', { configurable: true, get: () => trace.active, set(active) {
            trace.active = active;
            if (active && !trace.session) trace.session = active.session;
          }});
        }
      }, { input, brief });
      await hub.submit('single-entry', { brief });
      const connection = await visibleConnection(browser, runnerRoot);
      const readEntry = () => browser.execute(() => {
        const trace = window.__entryProbe;
        return { phase: trace.entry.phase, detail: trace.entry.detail, draft: trace.entry.draft,
          held: trace.held, started: trace.settlement, before: trace.lastLive, cards: trace.entry.attachments.candidates.filter(c => !c.submitted).length,
          invoked: trace.invoked, brief: trace.session?.control.brief.result,
          work: trace.session?.control.work.attempts.filter(attempt => !!attempt.instruction)
            .map(a => ({ instruction: a.instruction, identity: a.identity, submissionId: a.submissionId, work: a.work })) };
      });
      if (brief) {
        await wait(browser, async () => ['unknown', 'editing', 'delivered'].includes((await readEntry()).phase),
          'The original Brief observation did not settle', 115000);
        const before = await readEntry();
        console.log('Initial Brief result:', JSON.stringify(before));
        if (before.phase !== 'unknown' || !before.held.length || !before.brief?.runRequest)
          throw new UnverifiedObservation('Did not reach the native late-settlement gate');
        assert.equal(before.draft, body);
        assert.equal(before.cards, 1);
        await wait(browser, async () => {
          const { before } = await readEntry();
          return before?.activity?.status === 'running';
        }, 'No fresh Runner-owned Interpreter activity while the original Brief invocation was retained', 30_000)
          .catch(error => console.log(error.message));
        await browser.execute(() => { window.__entryProbe.release = true; });
      }
      await wait(browser, async () => {
        const state = await readEntry();
        return ['delivered', 'editing', 'incomplete'].includes(state.phase)
          || state.brief?.status === 'rejected' || state.work.some(attempt => attempt.work?.code === 'TARGET_BINDING_REQUIRED');
      },
        'No settled origin state from the original authenticated submission', 90000).catch(async error => {
        console.log('Unsettled origin:', JSON.stringify(await readEntry()));
        throw new UnverifiedObservation(error.message);
      });
      const final = await readEntry();
      console.log('Origin observation:', JSON.stringify(final));
      const observed = await snapshot(browser, connection);
      const registrations = observed.references?.results.filter(result => result.operation === 'references.register')
        .map(result => ({ id: result.id, state: result.state, reference: result.reference?.reference_id }));
      console.log('Authenticated binding:', JSON.stringify({ session: connection.session, generation: connection.generation,
        activity: observed.observation.issue_run_execution, registrations }));
      if (final.phase !== 'delivered') throw new UnverifiedObservation('The original submission did not report a verified start');
      await browser.execute(() => document.querySelector('.single-entry').click());
      const origin = await browser.execute(input => ({ draft: document.querySelector(input)?.value,
        cards: document.querySelectorAll('.attachment-chip').length }), input);
      assert.deepEqual(origin, { draft: '', cards: 0 });
      const registered = registrations?.filter(r => r.state === 'registered' && r.reference).map(r => r.reference) ?? [];
      const started = final.started, live = started?.activity;
      const issue = brief ? final.brief?.initiation?.issue_run_id : final.work[0]?.work?.work_id?.id;
      if (!issue) throw new UnverifiedObservation('No receiving IssueRun identity bound to the original request');
      const deliveries = acceptedInputs(runnerRoot, issue, brief, final.brief?.initiation?.authority_digest);
      console.log('Immutable receiving input:', JSON.stringify(deliveries));
      assert.equal(registered.length, 1);
      assert.equal(deliveries.length, 1);
      assert.deepEqual(deliveries[0].bodies, [body]);
      assert.deepEqual(deliveries[0].referenceIds, registered);
      if (live?.status !== 'running' || final.before?.activity?.status !== 'running')
        throw new UnverifiedObservation('No fresh native Interpreter before and at origin cleanup');
      assert.equal(live.issue_run_id, issue);
      assert.equal(final.before.activity.issue_run_id, issue);
      assert.deepEqual(final.before.activity.interpreter, live.interpreter);
      assert.equal(started.session, connection.session);
      assert.equal(started.generation, connection.generation);
      assert.equal(final.before.draft, body);
      assert.equal(final.before.cards.length, 1);
      assert.deepEqual(started.cards, []);
      if (brief) {
        assert.equal(final.invoked.filter(r => r.request.operation === 'run.invoke').length, 1);
        assert.equal(final.brief.initiation.invocation_request_id, final.brief.runRequest.id);
        assert.equal(final.brief.initiation.initiation_status, 'started');
      } else {
        assert.equal(final.work.length, 1);
        assert.equal(final.work[0].instruction, body);
        assert.equal(started.work?.started_event_id, 0);
        assert.equal(deliveries[0].actionId, live.interpreter.invocation_id);
        assert.equal(final.work[0].work.submission_request_id, final.work[0].submissionId);
      }
      await browser.execute(() => window.__entryProbe.restore());
      return { session: connection.session, generation: connection.generation, origin, registrations, deliveries, result: final };
    }
  };
}
