import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { registerSessionConfigUI } from './session-config-ui.mjs';
import { registerSingleEntryWork } from './single-entry-work.mjs';
import { registerRunnerTabs } from './runner-tabs.mjs';
import { registerRunnerTabRaces } from './runner-tab-races.mjs';
import { registerRunnerDiscovery } from './runner-work-discovery.mjs';
import { registerRunnerAddDirectory } from './runner-add-directory.mjs';
import { registerInstallationSetup } from './installation-setup.mjs';
import { registerTaskPanel } from './task-panel.mjs';
import { registerLogViewport } from './log-viewport.mjs';
import { registerHubSelectionUI } from './hub-selection-ui.mjs';
import { registerComposerAttachments } from './composer-attachments.mjs';

test.setTimeout(90_000);
test.use({ navigationTimeout: 60_000 });
registerLogViewport({ test, expect, transport, configure, create });
registerHubSelectionUI({ test, expect, transport, configure, create });
registerComposerAttachments({ test, expect, transport, configure, create: createWork });

async function transport(page, freshTarget, referenceOptions) {
  await page.addInitScript(({ freshTarget, referenceOptions }) => {
    const sessions = new Map();
    const observed = new Map();
    const callbacks = new Map(), listeners = new Map();
    const writes = [], resizes = [], acknowledgements = [], closed = [], commands = [], referenceRequests = [];
    const staged = [], clipboardReads = [], imageCloses = [], deliveredSets = [], revokedUrls = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { revokedUrls.push(url); revoke(url); };
    let missingImage = false, stageFailure = false, stageGate, releaseStage;
    let referenceSequence = 100, stableSequence = 0;
    const inventory = (items, offset = 0) => ({ total_count: items.length, offset,
      next_offset: offset + 2 < items.length ? offset + 2 : null,
      references: items.slice(offset, offset + 2).map((item, index) => ({ ...item, display_index: offset + index + 1 })) });
    const finishReference = (id, requestId, state = 'registered') => {
      const session = sessions.get(id), results = session.control.references.results;
      const result = results.find(item => item.id === requestId);
      const request = referenceRequests.find(item => item.id === id && item.requestId === requestId).request;
      if (request.operation === 'references.remove') {
        result.referenceId = request.reference_id;
        result.state = state === 'registered' ? 'removed' : state;
        result.removalStatus = result.state === 'removed' ? 'removed' : result.state === 'outcome-unknown' ? 'unknown' : 'not_removed';
        if (result.state === 'removed') session.items = session.items.filter(item => item.reference_id !== request.reference_id);
        return;
      }
      result.state = state;
      if (state === 'registered') {
        const request = referenceRequests.find(item => item.id === id && item.requestId === requestId).request;
        const reference = { reference_id: (++stableSequence).toString(16).padStart(32, '0'),
          display_index: session.items.length + 1, display_name: request.path.split(/[\\/]/).pop(), kind: 'file', image_detail: null, media_kind: null };
        session.items.push(reference);
        Object.assign(result, { registrationStatus: 'registered', reference, inventory: inventory(session.items) });
      } else if (['rejected', 'failure', 'outcome-unknown'].includes(state)) {
        Object.assign(result, { registrationStatus: state === 'outcome-unknown' ? 'unknown' : 'not_registered', code: `REFERENCE_${state.toUpperCase().replace('-', '_')}` });
      }
    };
    const canonical = id => ({ run_mode: 'task-run', target: freshTarget ?? { binding_state: 'bound', owner: 'Project', project: id },
      selection: { account: id, model: 'effective-model', reasoning_effort: 'medium', service_tier: 'default', source: 'execution',
        next_model: alignNew ? 'effective-model' : 'configured-model', next_reasoning_effort: alignNew ? 'medium' : 'high', next_service_tier: 'default' },
      execution: { lifecycle_state: 'INTERACTIVE_READY', owned_execution_alive: false, workflow_kind: '' },
      attention: { foreground_interaction_active: false, restart_confirmation_required: false,
        termination_confirmation_active: false, account_setup_required: false,
        awaiting_user_command_reason: '', suspension_status: 'inactive', suspension_reason: '' },
      commands: ['/status', '/target', '/model', '/account', '/run-mode', '/files', '/resume'].map(text => ({
        id: text, text, aliases: [], parent_id: null, visible: true, enabled: text !== '/resume',
        disabled_reason: text === '/resume' ? 'No suspended execution' : '', description: text,
        children: text === '/account' ? [
          { id: 'account.select', text: 'Select', visible: true, enabled: true, children: [] },
          { id: 'account.caption', text: '', visible: true, enabled: true, children: [] },
        ] : [],
      })) });
    let count = 0, callback = 0, failNext = false, failWrite = false, serial = 0, alignNew = false;
    let writeGate, releaseWrite;
    const emit = (id, text) => {
      const session = sessions.get(id);
      session.channel.onmessage({ type: 'output', id, sequence: ++session.sequence, bytes: [...new TextEncoder().encode(text)] });
    };
    const exit = (id, code = 0, control) => sessions.get(id).channel.onmessage({ type: 'exit', id, code, error: null, control });
    const nativeEvent = (event, payload, label = 'main') => {
      for (const [id, subscription] of listeners) {
        const receiver = subscription.target;
        const matches = receiver.label === label && ['Window', 'Webview', 'WebviewWindow'].includes(receiver.kind);
        if (subscription.event === event && matches) callbacks.get(id)({ event, id, payload });
      }
    };
    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: handler => { callbacks.set(++callback, handler); return callback; },
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === 'runner_resolve') {
          if (args.location === '/missing') throw new Error('Runner managed Python is missing. Run native bootstrap.');
          return { root: args.location === '/fixture/other' ? '/fixture/other' : '/fixture/install', python: '/fixture/python' };
        }
        if (command === 'pty_open') {
          count++;
          if (failNext) { failNext = false; throw new Error('fixture process launch failed'); }
          if (!['/fixture/install', '/fixture/other'].includes(args.request.runnerLocation)) throw new Error('Wrong configured installation');
          const id = `pty-${count}`;
          sessions.set(id, { channel: args.onEvent, sequence: 0, control: { state: 'ready', observation: canonical(id), results: [],
            clipboardStaging: !!referenceOptions?.clipboard } });
          if (referenceOptions?.work) {
            const { WorkFixture } = await import('/tests/fixtures/work.ts');
            const fixture = new WorkFixture(id, count);
            if (referenceOptions.workDiscovery) fixture.enableDiscovery();
            fixture.mode = referenceOptions.workMode ?? 'started';
            sessions.get(id).feature = fixture;
            sessions.get(id).control.features = fixture.features;
          }
          if (referenceOptions?.generatedImages) {
            sessions.get(id).control.generatedImagesSupported = true;
            sessions.get(id).images = referenceOptions.generatedImages.map((image, index) => ({ ...image,
              imageId: (count * 10 + index).toString(16).padStart(32, '0') }));
            if (count === 1 && referenceOptions.pauseFirstImage) {
              const session = sessions.get(id);
              session.imageReadGate = new Promise(resolve => { session.releaseImage = resolve; });
            }
          }
          if (referenceOptions) {
            sessions.get(id).items = [];
            sessions.get(id).control.references = { capability: { version: 1, inventory_page_size: 2,
              image_details: ['auto', 'low', 'high', 'original'] },
              removalCapability: referenceOptions.legacyRemoval ? null : { version: 1 }, results: [] };
          }
          setTimeout(() => emit(id, `\x1b[?9001h\x1b[?2004h\x1b[32m${id}: 안녕 🌍\x1b[0m\r\n`), 10);
          return id;
        }
        if (command === 'pty_write') {
          writes.push({ id: args.id, bytes: args.bytes });
          deliveredSets.push({ id: args.id, bytes: args.bytes, ids: sessions.get(args.id).items?.map(item => item.reference_id) ?? [] });
          if (writeGate) await writeGate;
          if (failWrite) { failWrite = false; throw new Error('fixture PTY write failed'); }
          return;
        }
        if (command === 'runner_observe') {
          const session = sessions.get(args.id), current = session.feature?.config.current;
          if (current) {
            Object.assign(session.control.observation, { run_mode: current.run_mode, target: { binding_state: 'bound',
              owner: current.target === 'workspace' ? 'Workspace' : 'Project', project: current.target === 'workspace' ? '' : 'Exact' } });
            Object.assign(session.control.observation.selection, { account: current.account.profile_name,
              model: current.model.id, reasoning_effort: current.model.reasoning_effort, service_tier: current.service_tier,
              source: 'configuration', next_model: current.model.id, next_reasoning_effort: current.model.reasoning_effort,
              next_service_tier: current.service_tier });
          }
          if (sessions.get(args.id).control.age) window.__nativeFixture.observedStale = true;
          observed.set(args.id, JSON.stringify(sessions.get(args.id).control));
          return structuredClone({ ...sessions.get(args.id).control, observationSerial: ++serial,
            observationAgeMs: sessions.get(args.id).control.age ?? 0 });
        }
        if (command === 'runner_images_list') {
          const session = sessions.get(args.id);
          if (session.imageFailure) throw session.imageFailure;
          return session.images;
        }
        if (command === 'runner_image_read') {
          const session = sessions.get(args.id);
          if (session.imageReadGate) await session.imageReadGate;
          const image = session.images.find(image => image.imageId === args.imageId);
          if (!image) throw { state: 'unavailable', detail: 'Fixture image is unavailable' };
          return { image, png: referenceOptions.generatedPng };
        }
        if (command === 'runner_command') {
          commands.push(args);
          const control = sessions.get(args.id).control;
          control.results = [{ id: commands.length, command: args.command, state: 'queued', changed: true }];
          return;
        }
        if (command === 'runner_feature') {
          const fixture = sessions.get(args.id).feature;
          if (args.request.feature === 'session_config') return fixture.config.submit(args.id, args.request.request);
          if (args.request.request.operation === 'work.submit') deliveredSets.push({ id: args.id,
            instruction: args.request.request.instruction, ids: sessions.get(args.id).items.map(item => item.reference_id) });
          return fixture.submit(args.request.request);
        }
        if (command === 'runner_reference') {
          const session = sessions.get(args.id), requestId = ++referenceSequence;
          referenceRequests.push({ ...args, requestId });
          if (args.request.operation === 'references.register' && referenceOptions.admissionFailure) return { state: 'failure', detail: 'Reference request was not submitted: fixture queue unavailable' };
          if (args.request.operation === 'references.register' && referenceOptions.unknownAdmission) return { state: 'outcome-unknown', detail: 'Fixture admission receipt lost; do not repeat' };
          const result = { id: requestId, operation: args.request.operation, offset: args.request.offset ?? 0, state: 'queued' };
          session.control.references.results.push(result);
          if (args.request.operation === 'references.list') {
            session.sampleCount = (session.sampleCount ?? 0) + 1;
            if (session.changeInventoryAt === session.sampleCount) session.items.push({ reference_id: 'f'.repeat(32),
              display_index: session.items.length + 1, display_name: 'terminal-added.txt', kind: 'file', image_detail: null, media_kind: null });
            Object.assign(result, { state: 'accepted', inventory: inventory(session.items, args.request.offset) });
          } else if (referenceOptions.auto) finishReference(args.id, requestId);
          return { state: 'admitted', id: requestId };
        }
        if (command === 'plugin:clipboard-manager|read_image') {
          clipboardReads.push(true);
          if (missingImage) throw new Error('Clipboard has no image');
          return 42;
        }
        if (command === 'plugin:image|size') return { width: 2, height: 1 };
        if (command === 'plugin:image|rgba') return [255, 0, 0, 255, 0, 255, 0, 255];
        if (command === 'plugin:resources|close') { imageCloses.push(args.rid); return; }
        if (command === 'runner_stage_clipboard') {
          if (stageGate) await stageGate;
          if (stageFailure) throw new Error('Fixture staging is not writable');
          const path = `/fixture/hub-owned/${args.id}/clipboard-${staged.length + 1}.png`;
          staged.push({ ...args, path }); return path;
        }
        if (command === 'plugin:dialog|open') return args.options.directory ? '/fixture/folder' : ['/fixture/image.png'];
        if (command === 'plugin:event|listen') { listeners.set(args.handler, { event: args.event, target: args.target }); return args.handler; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'pty_resize') { resizes.push(args); return; }
        if (command === 'pty_ack') { acknowledgements.push(args); return; }
        if (command === 'pty_close') { closed.push(args.id); exit(args.id, 1); return; }
        throw new Error(`Unexpected native fixture command: ${command}`);
      },
    };
    window.__nativeFixture = { sessions, observed, writes, resizes, acknowledgements, closed, commands, emit, exit,
      referenceRequests, finishReference,
      staged, clipboardReads, imageCloses, deliveredSets, revokedUrls,
      missingImage: value => { missingImage = value; }, stageFailure: value => { stageFailure = value; },
      pauseStage: () => { stageGate = new Promise(resolve => { releaseStage = resolve; }); },
      resumeStage: () => { stageGate = undefined; releaseStage(); },
      // Browser simulation only. The configured native content window emits by label.
      nativeEvent,
      drop: paths => nativeEvent('tauri://drag-drop', { paths, position: { x: 0, y: 0 } }),
      pauseWrites: () => { writeGate = new Promise(resolve => { releaseWrite = resolve; }); },
      resumeWrites: () => { writeGate = undefined; releaseWrite(); },
      count: () => count, failNext: () => { failNext = true; }, failWrite: () => { failWrite = true; },
      readyNew: () => { alignNew = true; } };
  }, { freshTarget, referenceOptions });
}

registerSessionConfigUI({ test, expect, transport, configure });
registerTaskPanel({ test, expect, transport, configure, create, generatedFixture });
registerSingleEntryWork({ test, expect, transport, configure, create });
registerRunnerTabs({ test, expect, transport, configure, create });
registerRunnerTabRaces({ test, expect, transport, configure, create: createPrepared, records });
registerRunnerDiscovery({ test, expect, transport, configure, create: createPrepared, records });
registerRunnerAddDirectory({ test, expect, transport, configure, create });
registerInstallationSetup({ test, expect, transport, configure, create });

test('hidden spare parses output and promotes the original PTY without a workspace record', async ({ page }) => {
  await transport(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
    const { resolveRunnerInstallation } = await import('/src/hub/runnerInstallation.ts');
    window.__spares = new RunnerSessions();
    window.__spares.setInstallation(await resolveRunnerInstallation('/fixture/install'));
  });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  await expect(page.locator('.runner-row')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toEqual([]);
  const promoted = await page.evaluate(() => {
    const session = window.__spares.promoteSpare();
    window.__promoted = session;
    return { id: session.control.sessionId, name: session.tab.name, protocol: session.input.win32,
      output: session.terminal.buffer.active.getLine(0).translateToString(true) };
  });
  expect(promoted).toEqual({ id: 'pty-1', name: 'Runner 1', protocol: true, output: 'pty-1: 안녕 🌍' });
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'promoted-terminal';
    container.style.cssText = 'position:fixed;inset:80px 20px 20px;z-index:10';
    document.body.appendChild(container);
    window.__detachPromoted = window.__promoted.attach(container, 'light');
  });
  await expect(page.locator('#promoted-terminal .xterm-rows')).toContainText('pty-1: 안녕 🌍');
  expect(await page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  await page.evaluate(() => { window.__detachPromoted(); return window.__spares.dispose(); });
});

async function spareOwner(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
    window.__spares = new RunnerSessions();
  });
}
async function prepareSpare(page, root = '/fixture/install') {
  await page.evaluate(async root => {
    const { resolveRunnerInstallation } = await import('/src/hub/runnerInstallation.ts');
    window.__spares.setInstallation(await resolveRunnerInstallation(root));
  }, root);
}

test('spare promotion assigns workspace order and replenishes once while other sessions remain independent', async ({ page }) => {
  await transport(page); await spareOwner(page);
  await page.evaluate(async () => {
    window.__visible = window.__spares.create('/fixture/install').session;
    const { RunnerSession } = await import('/src/hub/RunnerSessions.ts');
    window.__unrelated = new RunnerSession({ installationRoot: '/fixture/install' }, () => {});
    await window.__unrelated.open('/fixture/install');
  });
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  const first = await page.evaluate(() => {
    const session = window.__spares.promoteSpare();
    window.__firstSpare = session;
    let refused = false;
    try { window.__spares.promoteSpare(); } catch { refused = true; }
    return { id: session.control.sessionId, order: session.tab.createdOrder, name: session.tab.name, refused,
      identical: window.__spares.get(session.tab.id) === session, total: window.__nativeFixture.count() };
  });
  expect(first).toEqual({ id: 'pty-3', order: 2, name: 'Runner 2', refused: true, identical: true, total: 3 });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  await page.evaluate(() => { window.__secondSpare = window.__spares.promoteSpare(); });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  const state = await page.evaluate(async () => {
    const f = window.__nativeFixture, m = window.__spares;
    const result = { total: f.count(), ids: m.getSnapshot().map(v => m.get(v.id).control.sessionId),
      names: m.getSnapshot().map(v => v.name), saved: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs.length };
    await m.dispose();
    result.closed = [...f.closed];
    result.unrelated = window.__unrelated.assignmentAvailable;
    await window.__unrelated.dispose();
    return result;
  });
  expect(state).toEqual({ total: 5, ids: ['pty-1', 'pty-3', 'pty-4'], names: ['Runner 1', 'Runner 2', 'Runner 3'],
    saved: 3, closed: expect.arrayContaining(['pty-1', 'pty-3', 'pty-4', 'pty-5']), unrelated: true });
  expect(state.closed).not.toContain('pty-2');
});

for (const blocked of ['setup', 'foreground', 'authority', 'release', 'suspended', 'unsettled', 'settings']) {
  test(`hidden spare rejects canonical ${blocked} readiness without retrying`, async ({ page }) => {
    await transport(page); await spareOwner(page);
    await page.evaluate(blocked => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        const value = await invoke(command, args);
        if (command === 'pty_open') {
          const control = window.__nativeFixture.sessions.get(value).control, o = control.observation;
          if (blocked === 'setup') o.attention.account_setup_required = true;
          if (blocked === 'settings') o.selection.account = '';
          if (blocked === 'foreground') o.attention.foreground_interaction_active = true;
          if (blocked === 'authority') o.execution.owned_execution_alive = true;
          if (blocked === 'release') o.commands.find(c => c.text === '/target').enabled = false;
          if (blocked === 'suspended') o.attention.suspension_status = 'suspended';
          if (blocked === 'unsettled') control.results = [{ id: 1, command: '/model', state: 'outcome-unknown' }];
        }
        return value;
      };
    }, blocked);
    await prepareSpare(page);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
    expect(await page.evaluate(() => ({ state: window.__spares.spareSnapshot.state,
      count: window.__nativeFixture.count(), tabs: window.__spares.getSnapshot().length })))
      .toEqual({ state: 'unavailable', count: 1, tabs: 0 });
    expect(await page.evaluate(() => {
      try { window.__spares.promoteSpare(); return false; } catch { return true; }
    })).toBe(true);
    await page.evaluate(() => window.__spares.dispose());
  });
}

test('spare waits for authenticated observation and terminal protocol, drains queries, and rechecks freshness on promotion', async ({ page }) => {
  await transport(page); await spareOwner(page);
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    native.invoke = async (command, args) => {
      const value = await invoke(command, args);
      if (command === 'pty_open') {
        const session = window.__nativeFixture.sessions.get(value);
        session.control.state = 'connecting';
        const receive = session.channel.onmessage;
        window.__receiveSpare = receive;
        session.channel.onmessage = event => {
          if (event.type === 'output') event = { ...event, bytes: [...new TextEncoder().encode('Runner ready is only terminal text\r\n')] };
          receive(event);
        };
      }
      return value;
    };
  });
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('preparing');
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.state = 'ready'; });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('preparing');
  await page.evaluate(() => {
    const session = window.__nativeFixture.sessions.get('pty-1');
    session.channel.onmessage = window.__receiveSpare;
  });
  // Send negotiated protocol through the original bridge, retaining the hidden terminal buffer.
  await page.evaluate(() => {
    const f = window.__nativeFixture, session = f.sessions.get('pty-1');
    session.channel.onmessage({ type: 'output', id: 'pty-1', sequence: ++session.sequence,
      bytes: [...new TextEncoder().encode('\x1b[?9001h\x1b[6n')] });
  });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const f = window.__nativeFixture, control = f.sessions.get('pty-1').control;
    control.age = 3000;
  });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('unavailable');
  expect(await page.evaluate(() => {
    try { window.__spares.promoteSpare(); return false; } catch { return true; }
  })).toBe(true);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.age = 0; });
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  const protocol = await page.evaluate(() => {
    const session = window.__spares.promoteSpare();
    return { id: session.control.sessionId, available: session.assignmentAvailable, win32: session.input.win32 };
  });
  expect(protocol).toEqual({ id: 'pty-1', available: true, win32: true });
  await page.evaluate(() => window.__spares.dispose());
});

test('spare timeout, launch failure and disconnection remain bounded and actionable', async ({ page }) => {
  await transport(page); await spareOwner(page);
  await page.evaluate(() => window.__nativeFixture.failNext());
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('unavailable');
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-2').control.state = 'disconnected'; });
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-2']);
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    native.invoke = async (command, args) => {
      const value = await invoke(command, args);
      if (command === 'pty_open') window.__nativeFixture.sessions.get(value).control.state = 'connecting';
      return value;
    };
  });
  await page.clock.install();
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(3);
  await page.clock.fastForward(41000);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-2', 'pty-3']);
  expect(await page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('unavailable');
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(3);
  await page.evaluate(() => window.__spares.dispose());
});

test('installation change and shutdown join late spare launches and discard stale results', async ({ page }) => {
  await transport(page); await spareOwner(page);
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    let release;
    window.__openGate = new Promise(resolve => { release = resolve; });
    window.__releaseOpen = release;
    native.invoke = async (command, args) => {
      if (command === 'pty_open' && !window.__heldOpen) {
        window.__heldOpen = true;
        const result = await invoke(command, args);
        await window.__openGate;
        return result;
      }
      return invoke(command, args);
    };
  });
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  await page.evaluate(() => {
    window.__spares.setInstallation({ root: '/fixture/other', python: '/fixture/reverified-python' });
  });
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  await page.evaluate(() => window.__releaseOpen());
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    let release;
    window.__secondGate = new Promise(resolve => { release = resolve; });
    window.__releaseSecond = release;
    native.invoke = async (command, args) => {
      if (command === 'pty_open') { const id = await invoke(command, args); await window.__secondGate; return id; }
      return invoke(command, args);
    };
    window.__spares.setInstallation({ root: '/fixture/install', python: '/fixture/third-python' });
  });
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(3);
  await page.evaluate(() => { window.__disposing = window.__spares.dispose(); window.__releaseSecond(); });
  await page.evaluate(() => window.__disposing);
  expect(await page.evaluate(() => ({ state: window.__spares.spareSnapshot.state,
    count: window.__nativeFixture.count(), closed: window.__nativeFixture.closed, tabs: window.__spares.getSnapshot().length })))
    .toEqual({ state: 'disposed', count: 3, closed: ['pty-1', 'pty-2', 'pty-3'], tabs: 0 });
});

test('invalid saved installation blocks restart prewarming until the user verifies a correction', async ({ page }) => {
  await transport(page);
  await page.addInitScript(() => localStorage.setItem('agent-runner-hub.installation', '/missing'));
  await page.goto('/');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('native bootstrap');
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(0);
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
  await page.getByRole('button', { name: 'Verify and Start', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.installation'))).toBe('/fixture/install');
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
});

test('spare cleanup failure prevents competing launches and remains observable on shutdown', async ({ page }) => {
  await transport(page); await spareOwner(page); await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    native.invoke = (command, args) => command === 'pty_close'
      ? Promise.reject(new Error('fixture teardown denied')) : invoke(command, args);
    window.__spares.setInstallation(null);
  });
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__spares.spareSnapshot.detail))).toContain('fixture teardown denied');
  expect(await page.evaluate(() => JSON.stringify(window.__spares.spareSnapshot.detail))).toContain('spare.cleanupFailed');
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('unavailable');
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('unavailable');
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  expect(await page.evaluate(async () => {
    try { await window.__spares.dispose(); return ''; } catch (reason) { return reason.message; }
  })).toContain('fixture teardown denied');
});

test('spare startup deadline refuses late PTY completion and joins it before replacement', async ({ page }) => {
  await transport(page); await spareOwner(page);
  await page.clock.install();
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    let release, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    window.__releaseStartup = release;
    native.invoke = async (command, args) => {
      if (command === 'pty_open' && !held) {
        held = true;
        const id = await invoke(command, args);
        await gate;
        return id;
      }
      return invoke(command, args);
    };
  });
  await prepareSpare(page);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  await page.clock.fastForward(41000);
  expect(await page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('unavailable');
  await page.evaluate(() => window.__spares.setInstallation({ root: '/fixture/other', python: '/fixture/python' }));
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  await page.evaluate(() => window.__releaseStartup());
  await page.clock.resume();
  await expect.poll(() => page.evaluate(() => window.__spares.spareSnapshot.state)).toBe('ready');
  expect(await page.evaluate(() => ({ count: window.__nativeFixture.count(), closed: window.__nativeFixture.closed,
    tabs: window.__spares.getSnapshot().length, root: window.__spares.spareSnapshot.installation.root })))
    .toEqual({ count: 2, closed: ['pty-1'], tabs: 0, root: '/fixture/other' });
  await page.evaluate(() => window.__spares.dispose());
});

async function configure(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
  await page.getByRole('button', { name: 'Verify and Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Runner', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
}

function generatedFixture() {
  // Synthetic PNG and delivery boundary; never genuine Codex generation evidence.
  const png = PNG.sync.write({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) });
  const image = { sourceSequence: 1, outputIndex: 0, source: 'codex.imageGeneration', mimeType: 'image/png',
    byteLength: png.length, sha256: createHash('sha256').update(png).digest('hex'), width: 2, height: 1 };
  return { generatedImages: [image, { ...image, sourceSequence: 2 }], generatedPng: [...png] };
}

test('live Hub language and theme preserve Runner output, ownership, settings, controls and references', async ({ page }, testInfo) => {
  await transport(page, undefined, { clipboard: true, auto: true, ...generatedFixture() });
  await configure(page); await create(page);
  const id = await page.locator('.runner-row').first().getAttribute('data-runner-id');
  const target = await page.getByRole('combobox', { name: 'Requested Project / Target', exact: true }).inputValue();
  await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('draft /status 그대로');
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.locator('.attachment-chip')).toContainText('Staged');
  await page.locator('.generated-images summary').click();
  await expect(page.getByRole('img', { name: 'Verified generated image', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: '요청 프로젝트 / 대상', exact: true })).toHaveValue(target);
  await expect(page.getByRole('textbox', { name: 'Runner 지시문', exact: true })).toHaveValue('draft /status 그대로');
  await expect(page.locator('.attachment-chip')).toContainText('임시');
  await expect(page.getByRole('img', { name: '검증된 생성 이미지', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '앱 설정', exact: true }).click();
  await page.getByRole('button', { name: '블랙', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.xterm-scrollable-element')).toHaveCSS('background-color', 'rgb(17, 18, 20)');
  await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
  expect(await page.locator('.runner-row').first().getAttribute('data-runner-id')).toBe(id);
  await testInfo.attach('live-runner-korean-black', { body: await page.screenshot(), contentType: 'image/png' });
});


test('Single Entry preferences restore all safe selections and revalidate them before delivery', async ({ page }) => {
  await transport(page, undefined, { work: true, auto: true });
  await configure(page); await create(page); await entry(page, 'private instruction never saved');
  await page.getByRole('button', { name: 'Refresh available choices', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Requested Account', exact: true }).getByRole('option', { name: 'codex / first', exact: true })).toBeAttached();
  await page.getByRole('combobox', { name: 'Requested Account', exact: true }).selectOption(JSON.stringify({ agent_id: 'codex', profile_name: 'first' }));
  await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Requested Model', exact: true }).selectOption({ label: 'm2' });
  await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
  await page.getByRole('combobox', { name: 'Requested Project / Target', exact: true }).selectOption(JSON.stringify({ binding_state: 'bound', owner: 'Project', project: 'Exact' }));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')));
  expect(Object.keys(saved.singleEntry).sort()).toEqual(['accountIdentity', 'allocationPolicy', 'initialized', 'model', 'runMode', 'target']);
  expect(JSON.stringify(saved)).not.toContain('private instruction');
  await page.reload();
  await expect(page.getByText('Restored defaults are requests only.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
  await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('confirmed after restart');
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
  const current = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.config.current);
  expect(current.account).toEqual(saved.singleEntry.accountIdentity);
  expect(current.run_mode).toBe(saved.singleEntry.runMode);
  expect(current.model.id).toBe(saved.singleEntry.model.model);
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry)).toEqual(saved.singleEntry);
});

test('Single Entry explicitly recovers retained Fast while preserving model and other defaults', async ({ page }) => {
  await transport(page, undefined, { auto: true, work: true }); await configure(page);
  await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
  const model = page.getByRole('combobox', { name: 'Requested Model', exact: true });
  await expect(model).toBeEnabled();
  await model.selectOption({ label: 'm0' });
  await page.getByRole('combobox', { name: 'Requested Reasoning effort', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
  await page.getByRole('checkbox', { name: 'Fast', exact: true }).check();
  await model.selectOption({ label: 'm1' });
  await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Saved value retained: fast' })).toBeVisible();
  await page.locator('.app-settings-trigger').click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '기본 서비스 등급 사용', exact: true }).focus();
  await page.keyboard.press('Enter');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry);
  expect(saved.model).toEqual({ model: 'm1', reasoning_effort: 'high', service_tier: 'default' });
  expect(saved.runMode).toBe('issue-run');
  await expect(page.getByRole('checkbox', { name: 'Fast', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
});

test('Runner observations do not become Hub defaults and raw native errors retain their diagnostic language', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.preferences.v1'))).toBeNull();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).singleEntry)).toEqual({});
  await page.getByRole('button', { name: '앱 설정', exact: true }).click();
  await page.getByRole('textbox', { name: 'AgentRunner 위치', exact: true }).fill('/missing');
  await page.getByRole('button', { name: '설치 검증', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Runner managed Python is missing. Run native bootstrap.');
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
});

test('generated image reads retain their original owner across asynchronous tab switches', async ({ page }) => {
  await transport(page, undefined, { ...generatedFixture(), pauseFirstImage: true }); await configure(page); await create(page); await page.locator('.generated-images summary').click();
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'loading');
  const firstId = await page.getByRole('combobox', { name: 'Select generated image' }).inputValue();
  await create(page); await page.locator('.generated-images summary').click(); const image = page.getByRole('img', { name: 'Verified generated image', exact: true });
  await expect(image).toBeVisible(); const secondUrl = await image.getAttribute('src');
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').releaseImage());
  await expect(image).toHaveAttribute('src', secondUrl);
  expect(await page.getByRole('combobox', { name: 'Select generated image' }).inputValue()).not.toBe(firstId);
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await page.locator('.generated-images summary').click();
  await expect(page.getByRole('combobox', { name: 'Select generated image' })).toHaveValue(firstId);
  await expect(image).toBeVisible(); await expect(image).not.toHaveAttribute('src', secondUrl);
});

test('generated image resources revoke on selection and owned exit without affecting another live Runner', async ({ page }) => {
  await page.addInitScript(() => { const original = URL.revokeObjectURL.bind(URL); window.__revokedImages = [];
    URL.revokeObjectURL = url => { window.__revokedImages.push(url); original(url); }; });
  await transport(page, undefined, generatedFixture()); await configure(page); await create(page); await page.locator('.generated-images summary').click();
  const image = page.getByRole('img', { name: 'Verified generated image', exact: true }); await expect(image).toBeVisible();
  const original = await image.getAttribute('src');
  await page.getByRole('combobox', { name: 'Select generated image' }).selectOption({ index: 1 }); await expect(image).toBeVisible();
  await expect.poll(() => page.evaluate(url => window.__revokedImages.includes(url), original)).toBe(true);
  const first = await image.getAttribute('src'); await create(page); await page.locator('.generated-images summary').click(); await expect(image).toBeVisible();
  const second = await image.getAttribute('src'); await page.evaluate(() => window.__nativeFixture.exit('pty-1'));
  await expect.poll(() => page.evaluate(url => window.__revokedImages.includes(url), first)).toBe(true);
  expect(await page.evaluate(url => window.__revokedImages.includes(url), second)).toBe(false);
  await expect(image).toHaveAttribute('src', second);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-2').control.generatedImagesSupported = false; });
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'unsupported');
  await expect.poll(() => page.evaluate(url => window.__revokedImages.includes(url), second)).toBe(true);
});

test('generated image states reject unavailable sources and discard late reads after Runner exit', async ({ page }) => {
  await transport(page, undefined, generatedFixture()); await configure(page); await create(page); await page.locator('.generated-images summary').click();
  await expect(page.getByRole('img', { name: 'Verified generated image', exact: true })).toBeVisible();
  await page.evaluate(() => { const a = window.__nativeFixture.sessions.get('pty-1');
    a.imageFailure = { state: 'unavailable', detail: 'Fixture image expired' }; });
  await page.getByRole('button', { name: 'Refresh images' }).click();
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('.generated-image-preview')).toHaveCount(0);
  await page.evaluate(() => { const a = window.__nativeFixture.sessions.get('pty-1'); a.imageFailure = undefined; a.images = []; });
  await page.getByRole('button', { name: 'Refresh images' }).click();
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'empty');
  await create(page); await page.locator('.generated-images summary').click(); await expect(page.getByRole('img', { name: 'Verified generated image', exact: true })).toBeVisible();
  await page.evaluate(() => { const a = window.__nativeFixture.sessions.get('pty-2');
    a.imageReadGate = new Promise(resolve => { a.releaseImage = resolve; }); });
  await page.getByRole('button', { name: 'Refresh images' }).click();
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'loading');
  await page.evaluate(() => { window.__nativeFixture.exit('pty-2'); window.__nativeFixture.sessions.get('pty-2').releaseImage(); });
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('.generated-image-preview')).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'));
  expect(stored).not.toMatch(/sha256|imageId|blob:|data:image|generatedImages/);
});

test('generated image previews render verified delivery, select, enlarge, refresh and isolate tabs', async ({ page }, testInfo) => {
  await transport(page, undefined, generatedFixture()); await configure(page); await create(page); await page.locator('.generated-images summary').click();
  const image = page.getByRole('img', { name: 'Verified generated image', exact: true });
  await expect(image).toBeVisible();
  expect(await image.evaluate(element => element.naturalWidth)).toBe(2);
  const firstUrl = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Enlarge generated image' }).click();
  await expect(page.getByRole('dialog', { name: 'Enlarged generated image' })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('combobox', { name: 'Select generated image' }).selectOption({ index: 1 });
  await expect(image).toBeVisible(); await expect(image).not.toHaveAttribute('src', firstUrl);
  await create(page); await page.locator('.generated-images summary').click(); await expect(image).toBeVisible(); const secondUrl = await image.getAttribute('src');
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await page.locator('.generated-images summary').click();
  await expect(image).toBeVisible(); await expect(image).not.toHaveAttribute('src', secondUrl);
  await page.getByRole('button', { name: 'Refresh images' }).click(); await expect(image).toBeVisible();
  expect(await page.locator('.terminal-host').evaluate(element => !!element.querySelector('.xterm'))).toBe(true);
  await testInfo.attach('synthetic-generated-image-preview', { body: await page.screenshot(), contentType: 'image/png' });
});






async function create(page) {
  await page.getByRole('button', { name: 'New Runner', exact: true }).click();
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
}
async function foreground(page, id, active) {
  await page.evaluate(({ id, active }) => {
    window.__nativeFixture.sessions.get(id).control.observation.attention.foreground_interaction_active = active;
  }, { id, active });
  await page.waitForFunction(({ id, active }) => JSON.parse(window.__nativeFixture.observed.get(id))
    .observation.attention.foreground_interaction_active === active, { id, active });
  await page.waitForTimeout(600);
}
async function createWork(page) {
  await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })
    .getByRole('option', { name: 'm0', exact: true })).toBeAttached();
  await create(page);
  const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
  await mode.focus();
  await mode.selectOption({ label: 'task-run' });
}
async function createPrepared(page) {
  if (!await page.locator('.runner-row').count()) {
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })
      .getByRole('option', { name: 'm0', exact: true })).toBeAttached();
  }
  const prepared = () => page.evaluate(() => {
    const f = window.__nativeFixture, id = `pty-${f.count()}`;
    return f.observed.has(id) && f.acknowledgements.some(ack => ack.id === id);
  });
  await expect.poll(prepared).toBe(true);
  await create(page);
  await expect.poll(prepared).toBe(true);
}








test('foreground PTY uncertainty preserves the draft and blocks Hub replay', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await foreground(page, 'pty-1', true);
  await page.getByLabel('Runner instructions', { exact: true }).fill('One uncertain ordinary delivery');
  await page.evaluate(() => window.__nativeFixture.failWrite());
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'PTY delivery outcome unknown' })).toBeVisible();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('One uncertain ordinary delivery');
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
});




function records(writes, id) {
  const text = writes.filter(write => write.id === id).map(write => String.fromCharCode(...write.bytes)).join('');
  return [...text.matchAll(/\x1b\[(\d+);(\d+);(\d+);([01]);(\d+);(\d+)_/g)]
    .map(match => ({ vk: +match[1], char: +match[3], down: match[4] === '1', modifiers: +match[5] }));
}

test('workspace restores five stable tabs without replaying input or commands', async ({ page }) => {
  await transport(page); await configure(page);
  for (let index = 0; index < 5; index++) await create(page);
  await page.getByRole('button', { name: 'Rename Runner 2', exact: true }).click();
  await page.getByRole('textbox', { name: 'Runner name', exact: true }).fill('Durable 이름');
  await page.getByRole('textbox', { name: 'Runner name', exact: true }).press('Enter');
  await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('must never replay');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
  expect(saved.tabs).toHaveLength(5);
  expect(saved.tabs[1].name).toBe('Durable 이름');
  expect(saved.tabs[1].lastVerified.target.owner).toBe('Project');
  expect(JSON.stringify(saved)).not.toContain('must never replay');
  for (let reopening = 0; reopening < 2; reopening++) {
    await page.reload();
    await expect(page.locator('.runner-row')).toHaveCount(5);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(6);
    expect(await page.locator('.runner-row').evaluateAll(rows => rows.map(row => row.dataset.runnerId)))
      .toEqual(saved.tabs.map(tab => tab.id));
    await page.locator('.runner-row').nth(1).locator('.nav-row').click();
    await expect(page.getByRole('heading', { name: 'Durable 이름', exact: true })).toBeVisible();
    await expect(page.getByLabel('Restored Runner recovery')).toContainText('Historical work recovery is unconfirmed');
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
    expect(await page.evaluate(() => [window.__nativeFixture.writes, window.__nativeFixture.commands])).toEqual([[], []]);
  }
});

for (const target of [
  { binding_state: 'bound', owner: 'Project', project: 'Fresh B' },
  { binding_state: 'unbound', owner: '', project: '' },
]) {
  test(`workspace retains historical A across fresh ${target.project || 'unbound'} observations and settings changes`, async ({ page }) => {
    await transport(page, target); await configure(page); await create(page);
    const historical = { target: { binding_state: 'bound', owner: 'Project', project: 'Historical A' },
      runMode: 'issue-run', workflowKind: 'IssueRun' };
    await page.evaluate(context => {
      const observation = window.__nativeFixture.sessions.get('pty-1').control.observation;
      observation.target = context.target; observation.run_mode = context.runMode;
      observation.execution.workflow_kind = context.workflowKind;
    }, historical);
    const verified = () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0].lastVerified);
    await expect.poll(verified).toEqual(historical);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
    expect(saved.tabs[0].lastVerified).toEqual(historical);
    expect(saved.tabs[0].recoveryHint).toBeUndefined();
    for (let reopening = 0; reopening < 3; reopening++) {
      await page.reload();
      await expect(page.locator('.runner-row')).toHaveCount(1);
      await page.locator('.runner-row .nav-row').click();
      await expect.poll(verified).toEqual({ target, runMode: 'task-run', workflowKind: '' });
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
      expect(persisted.tabs[0].id).toBe(saved.tabs[0].id);
      expect(persisted.tabs[0].createdOrder).toBe(saved.tabs[0].createdOrder);
      expect(persisted.tabs[0].lastVerified).toEqual({ target, runMode: 'task-run', workflowKind: '' });
      const recovery = page.getByLabel('Restored Runner recovery');
      await expect(recovery).toContainText('Historical target: Project / Historical A');
      expect(persisted.tabs[0].recoveryHint).toEqual(historical);
      await expect(recovery).toContainText('Previous run mode: issue-run');
      await expect(recovery).toContainText('Previous workflow: IssueRun');
      await expect(page.locator('.task-panel .terminal-observation')).toHaveCount(0);
      await expect(recovery).toContainText('Historical work recovery is unconfirmed');
      expect(await page.evaluate(() => [window.__nativeFixture.writes, window.__nativeFixture.commands])).toEqual([[], []]);
      if (reopening === 0) {
        await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('/target');
        await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
        await page.evaluate(() => {
          const control = window.__nativeFixture.sessions.get('pty-1').control;
          control.observation.target = { binding_state: 'bound', owner: 'Project', project: 'Changed C' };
          control.observation.run_mode = 'direct-run';
          control.results = [{ id: 1, command: '/target', state: 'accepted', changed: true }];
          control.observation.commands.push({ id: 'recover', text: '/recover', aliases: [], parent_id: null,
            visible: true, enabled: true, disabled_reason: '', description: 'Discover work', children: [] });
        });
        await expect.poll(verified).toEqual({ target: { binding_state: 'bound', owner: 'Project', project: 'Changed C' },
          runMode: 'direct-run', workflowKind: '' });
        await page.getByRole('button', { name: 'Recover earlier work', exact: true }).click();
        await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.results = [
          { id: 2, command: '/recover', state: 'accepted', code: 'SUCCESS' }]; });
        await expect(recovery).toContainText('Recover earlier work: accepted (SUCCESS)');
        await expect(recovery).not.toContainText('/recover');
        await expect(recovery).toContainText('Historical work recovery is unconfirmed');
        const changed = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0]);
        expect(changed.lastVerified.target.project).toBe('Changed C');
        expect(changed.lastVerified.runMode).toBe('direct-run');
        expect(changed.recoveryHint).toEqual(historical);
      }
    }
  });
}

test('workspace isolates malformed records, duplicate identities and launch failures', async ({ page }) => {
  await transport(page);
  await page.addInitScript(() => {
    localStorage.setItem('agent-runner-hub.installation', '/fixture/install');
    const tab = (index, root = '/fixture/install') => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `Saved ${index}`, createdOrder: index, installationRoot: root, launchOnOpen: true });
    localStorage.setItem('agent-runner-hub.workspace.v1', JSON.stringify({ version: 1,
      tabs: [tab(3), tab(1), tab(1), { ...tab(9), id: 'bad' }, tab(2, '/missing'),
        { ...tab(8), createdOrder: 3 }, { ...tab(4), installationRoot: 'relative' },
        { ...tab(5), recoveryHint: { target: null } }] }));
    window.__nativeFixture.failNext();
  });
  await page.goto('/');
  await expect(page.locator('.runner-row')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(4);
  expect(await page.locator('.runner-row .runner-name').allTextContents()).toEqual(['Saved 1', 'Saved 2', 'Saved 3']);
  await page.locator('.runner-row').nth(0).locator('.nav-row').click();
  await expect(page.getByText('fixture process launch failed', { exact: false })).toBeVisible();
  await page.locator('.runner-row').nth(1).locator('.nav-row').click();
  await expect(page.getByText('Wrong configured installation', { exact: false })).toBeVisible();
  await expect(page.locator('.runner-controls .control-status')).toContainText('Control disconnected');
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('Recovery unavailable');
  await page.locator('.runner-row').nth(2).locator('.nav-row').click();
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'invalid or duplicate' })).toBeVisible();
});

for (const raw of ['{"version":1,"tabs":[', '{"version":99,"tabs":[]}']) {
  test(`workspace retains unreadable or unsupported data: ${raw}`, async ({ page }) => {
    await transport(page);
    await page.addInitScript(raw => localStorage.setItem('agent-runner-hub.workspace.v1', raw), raw);
    await configure(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Workspace restoration unavailable' })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'))).toBe(raw);
  });
}

test('workspace retains the last atomic commit when storage rejects a write', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.reload();
  await page.locator('.runner-row .nav-row').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1'))
    .tabs[0].lastVerified?.target.project)).toBe('pty-1');
  const before = await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'));
  expect(JSON.parse(before).tabs[0].recoveryHint.target.project).toBe('pty-1');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'agent-runner-hub.workspace.v1') throw new Error('fixture storage interrupted');
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Rename Runner 1', exact: true }).click();
  await page.getByRole('textbox', { name: 'Runner name', exact: true }).fill('Uncommitted');
  await page.getByRole('textbox', { name: 'Runner name', exact: true }).press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Workspace save failed' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'))).toBe(before);
  await page.reload();
  await expect(page.locator('.runner-row')).toHaveCount(1);
  await page.locator('.runner-row .nav-row').click();
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('Historical target: Project / pty-1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0].name)).toBe('Runner 1');
});

test('restored recovery uses only the current canonical command and terminal outcome', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.reload();
  await page.locator('.runner-row .nav-row').click();
  const button = page.getByRole('button', { name: 'Recover earlier work', exact: true });
  await expect(button).toBeDisabled();
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').control.observation.commands.push({
    id: 'recover', text: '/recover', aliases: [], parent_id: null, visible: true, enabled: true,
    disabled_reason: '', description: 'Discover retained work', children: [],
  }));
  await expect(button).toBeEnabled();
  await button.click();
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([{ id: 'pty-1', command: '/recover' }]);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.results = [
    { id: 1, command: '/recover', state: 'pending-interaction' }]; });
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('pending-interaction');
  await expect(button).toBeDisabled();
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.results = [
    { id: 1, command: '/recover', state: 'rejected', code: 'CANCELLED' }]; });
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('rejected (CANCELLED)');
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('Historical work recovery is unconfirmed');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
});

test('workspace keeps ended tabs dormant and strips untrusted replay fields', async ({ page }) => {
  await transport(page);
  await page.addInitScript(() => localStorage.setItem('agent-runner-hub.workspace.v1', JSON.stringify({ version: 1,
    tabs: [{ id: '10000000-0000-4000-8000-000000000001', name: 'Ended', createdOrder: 4,
      installationRoot: '/fixture/install', launchOnOpen: false,
      recoveryHint: { target: { binding_state: 'bound', owner: 'Project', project: 'Retained A', key: 'private' },
        runMode: 'task-run', workflowKind: 'TaskRun', instructions: 'never persist' },
      pid: 42, pty: 'old', key: 'secret', draft: 'replay', instruction: 'execute', sessionId: 'stale' }] })));
  await configure(page);
  await expect(page.locator('.runner-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
  expect(Object.keys(stored.tabs[0]).sort()).toEqual(['createdOrder', 'id', 'installationRoot', 'launchOnOpen', 'name', 'recoveryHint']);
  expect(stored.tabs[0].recoveryHint).toEqual({ target: { binding_state: 'bound', owner: 'Project', project: 'Retained A' },
    runMode: 'task-run', workflowKind: 'TaskRun' });
  await page.locator('.runner-row .nav-row').click();
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('Historical target: Project / Retained A');
  await expect(page.locator('.task-panel .terminal-observation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Project / Target /target', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recover earlier work', exact: true })).toBeDisabled();
});

test('workspace drops an uncertain Single Entry submission on reopening', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await entry(page, '/WG6 uncertain instruction');
  await page.evaluate(() => window.__nativeFixture.failWrite());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
  await expect(page.getByRole('alert').filter({ hasText: 'automatic retry and reassignment are blocked' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'))).not.toContain('WG6 uncertain instruction');
  await page.reload();
  await expect(page.locator('.runner-row')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => [window.__nativeFixture.writes, window.__nativeFixture.commands])).toEqual([[], []]);
});

test('Single Entry creates when no eligible idle Runner exists', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.execution.owned_execution_alive = true; });
  await page.waitForFunction(() => {
    const f = window.__nativeFixture;
    return f.observed.get('pty-1') === JSON.stringify(f.sessions.get('pty-1').control);
  });
  await entry(page);
  await page.evaluate(() => window.__nativeFixture.readyNew());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(3);
  expect((await page.evaluate(() => window.__nativeFixture.writes)).map(w => w.id)).toEqual(['pty-2']);
});

for (const exclusion of ['suspended', 'disconnected', 'retained', 'unknown', 'foreground', 'confirmation', 'incomplete-evidence', 'stale']) {
  test(`Single Entry excludes ${exclusion} Runner`, async ({ page }) => {
    await transport(page); await configure(page); await create(page); await create(page);
    await page.evaluate(kind => {
      const c = window.__nativeFixture.sessions.get('pty-1').control;
      if (kind === 'suspended') c.observation.attention.suspension_status = 'active';
      if (kind === 'disconnected') c.state = 'disconnected';
      if (kind === 'retained') c.observation.commands.find(c => c.text === '/target').enabled = false;
      if (kind === 'unknown') c.results = [{ id: 1, command: '/model', state: 'outcome-unknown' }];
      if (kind === 'foreground') c.observation.attention.foreground_interaction_active = true;
      if (kind === 'confirmation') c.observation.attention.restart_confirmation_required = true;
      if (kind === 'incomplete-evidence') delete c.observation.attention.termination_confirmation_active;
      if (kind === 'stale') c.age = 10000;
    }, exclusion);
    await page.waitForFunction(() => {
      const f = window.__nativeFixture;
      return f.observed.get('pty-1') === JSON.stringify(f.sessions.get('pty-1').control);
    });
    if (['disconnected', 'unknown', 'stale'].includes(exclusion)) {
      await page.locator('.runner-row').first().locator('.nav-row').click();
      if (exclusion !== 'stale') await expect(page.locator('.task-panel .runner-controls')).toHaveCount(0);
      else await expect.poll(() => page.evaluate(() => window.__nativeFixture.observedStale)).toBeTruthy();
    }
    await entry(page);
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
    await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
    expect((await page.evaluate(() => window.__nativeFixture.writes)).map(w => w.id)).toEqual(['pty-2']);
  });
}

test('Single Entry preserves configuration confirmation and can transfer its known-unsent draft', async ({ page }) => {
  await transport(page, undefined, { work: true, auto: true }); await configure(page); await create(page);
  await entry(page, 'held instruction');
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.config.planStatus = 'confirmation_required'; });
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
  await expect(page.locator('.control-status')).toContainText('Hub cannot approve it');
  expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions' })).toHaveValue('held instruction');
  await page.getByRole('button', { name: 'Move unsent instruction to Runner' }).click();
  await page.getByRole('button', { name: 'Open assigned Runner' }).click();
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('held instruction');
});

test('Single Entry write failure remains ambiguous without replay or reassignment', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await entry(page); await page.evaluate(() => window.__nativeFixture.failWrite());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
  await expect(page.getByRole('alert')).toContainText('automatic retry and reassignment are blocked');
  await page.getByRole('button', { name: 'Open assigned Runner' }).click();
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('/status');
  await expect(page.getByRole('button', { name: 'Assign instruction' })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
});

test('Single Entry launch failure retains its draft without retry', async ({ page }) => {
  await transport(page); await configure(page);
  await page.getByRole('textbox', { name: 'Single Entry instructions' }).fill('/status');
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.state = 'disconnected'; });
  await expect(page.getByRole('status').filter({ hasText: 'Spare unavailable:' })).toBeVisible();
  await page.evaluate(() => window.__nativeFixture.failNext());
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'fixture process launch failed' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions' })).toHaveValue('/status');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
});

test('Single Entry process exit during readiness leaves the instruction unsent', async ({ page }) => {
  await transport(page); await configure(page); await create(page); await entry(page);
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await page.evaluate(() => window.__nativeFixture.exit('pty-1', 7));
  await expect(page.getByRole('status').filter({ hasText: /Runner process exited|Instruction unsent/ })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
});

test('Single Entry excludes delivered terminal input from explicit idle reuse', async ({ page }) => {
  await transport(page); await configure(page); await create(page); await create(page); await entry(page);
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Single Entry instructions' }).fill('/status');
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.map(w => w.id))).toEqual(['pty-1', 'pty-2']);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(3);
});

test('Single Entry uses one bracketed-paste write on VT terminals', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b[?9001l'));
  await entry(page, '/hub-unknown\n안녕 🌍');
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  const writes = await page.evaluate(() => window.__nativeFixture.writes);
  expect(writes).toHaveLength(1);
  expect(new TextDecoder().decode(new Uint8Array(writes[0].bytes))).toBe('\x1b[200~/hub-unknown\r안녕 🌍\x1b[201~\r');
});

test('Single Entry creates its first Runner and rapid concurrent calls deliver once', async ({ page }) => {
  await transport(page); await configure(page);
  await page.evaluate(() => window.__nativeFixture.readyNew());
  await page.getByRole('textbox', { name: 'Single Entry instructions' }).fill('/status');
  await page.getByRole('button', { name: 'Assign instruction' }).evaluate(button => {
    for (let i = 0; i < 4; i++) button.click();
  });
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
});

test('terminal color, cursor, device and focus replies preserve idle input ownership', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b]10;?\x07\x1b[5n\x1b[6n\x1b[c\x1b[?1004h'));
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
  await entry(page);
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  const writes = await page.evaluate(() => window.__nativeFixture.writes);
  expect(records(writes, 'pty-1').map(record => record.char)).toEqual([47, 115, 116, 97, 116, 117, 115, 13]);
});

test('manual terminal input remains ineligible and is never appended to by assignment', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await foreground(page, 'pty-1', true);
  await page.locator('.xterm-helper-textarea').press('x');
  await foreground(page, 'pty-1', false);
  await entry(page); await page.evaluate(() => window.__nativeFixture.readyNew());
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  const writes = await page.evaluate(() => window.__nativeFixture.writes);
  expect(records(writes, 'pty-1').some(record => record.char === 47)).toBe(false);
  expect(records(writes, 'pty-2').map(record => record.char)).toEqual([47, 115, 116, 97, 116, 117, 115, 13]);
});

async function assignedEntry(page) {
  await expect(page.getByRole('main', { name: 'Runner workspace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
}

async function entry(page, text = '/status') {
  await page.evaluate(() => { for (const { control } of window.__nativeFixture.sessions.values()) {
    const s = control.observation.selection;
    s.next_model = s.model; s.next_reasoning_effort = s.reasoning_effort; s.next_service_tier = s.service_tier;
  } });
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Reuse an eligible idle Runner' }).check();
  await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill(text);
}


test('Single Entry skips a Runner with prepared references and verifies the chosen empty inventory', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText(/Registered · completed Runner receipt/)).toBeVisible();
  await create(page); await entry(page);
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes.map(item => item.id))).toEqual(['pty-2']);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.list').map(item => item.id))).toEqual(['pty-2']);
  expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.length)).toBe(1);
});


test('Single Entry leaves an instruction unsent when a fresh inventory reveals terminal-prepared references', async ({ page }) => {
  await transport(page, undefined, {}); await configure(page); await create(page);
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.push({ reference_id: 'a'.repeat(32),
    display_index: 1, display_name: 'terminal-only.txt', kind: 'file', image_detail: null, media_kind: null }));
  await entry(page); await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await assignedEntry(page);
  await expect(page.getByRole('status').filter({ hasText: 'Runner pending references are present or unverified' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('/status');
});

test('Single Entry reserves idle terminal input and delivers slash command Unicode once across tabs', async ({ page }, testInfo) => {
  await transport(page); await configure(page); await create(page); await create(page);
  await entry(page, '/first line\n안녕 🌍');
  await page.evaluate(() => window.__nativeFixture.pauseWrites());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBe(1);
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__nativeFixture.resumeWrites());
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
  const writes = await page.evaluate(() => window.__nativeFixture.writes);
  expect(writes).toHaveLength(1); expect(writes[0].id).toBe('pty-1');
  expect(records(writes, 'pty-1').map(r => r.char)).toEqual([...'/first line'].map(c => c.charCodeAt(0)).concat(13, '안'.charCodeAt(0), '녕'.charCodeAt(0), 32, 0xd83c, 0xdf0d, 13));
  await testInfo.attach('single-entry-delivered', { body: await page.screenshot(), contentType: 'image/png' });
});

test('canonical foreground replies remain on their original session across tab switches', async ({ page }) => {
  await transport(page); await configure(page); await create(page); await create(page);
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await foreground(page, 'pty-1', true);
  await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('answer');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeFixture.writes.map(w => w.id))).toEqual(['pty-1']);
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
  await page.locator('.runner-row').nth(1).locator('.nav-row').click();
  await expect(page.locator('.task-panel .command-button, .task-panel .shortcut-bar')).toHaveCount(0);
});

test('process exit retains final output without restoring command controls', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => {
    const n = window.__nativeFixture;
    n.emit('pty-1', '\r\nfinal output\r\n');
    n.exit('pty-1', 0, { ...n.sessions.get('pty-1').control, state: 'disconnected' });
  });
  await expect(page.getByText('Process exited (0)', { exact: true })).toBeVisible();
  await expect(page.locator('.xterm-rows')).toContainText('final output');
  await expect(page.locator('.task-panel .command-button, .task-panel .shortcut-bar')).toHaveCount(0);
});



test('Runner panels expose selection fields without command shortcuts in both languages', async ({ page }) => {
  await transport(page); await configure(page); await create(page); await create(page);
  for (const language of ['en', 'ko']) {
    await page.locator('.app-settings-trigger').click();
    await page.getByRole('combobox', { name: language === 'en' ? 'Language' : 'Language', exact: true }).selectOption(language);
    await page.keyboard.press('Escape');
    for (const row of [0, 1]) {
      await page.locator('.runner-row').nth(row).locator('.nav-row').click();
      await expect(page.locator('.task-panel .command-button, .task-panel .shortcut-bar, .task-panel .shortcut-editor')).toHaveCount(0);
      await expect(page.locator('.task-panel select')).toHaveCount(5);
    }
  }
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
});

test('two terminal sessions survive keyed views and keep independent output, input, drafts and geometry', async ({ page }, testInfo) => {
  await transport(page); await configure(page); await create(page);
  expect((await page.locator('.terminal-host').boundingBox()).height).toBeGreaterThan(180);
  const first = page.locator('.runner-row').first();
  const firstId = await first.getAttribute('data-runner-id');
  await page.evaluate(() => { window.__firstTerminal = document.querySelector('.xterm'); });
  const composer = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
  await composer.fill('first line\n안녕 🌍');
  await create(page);
  const secondId = await page.locator('.runner-row').last().getAttribute('data-runner-id');
  await expect(page.locator('.xterm-rows')).toContainText('pty-2: 안녕 🌍');
  await page.evaluate(() => window.__nativeFixture.emit('pty-2', '\x1b[6n'));
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.some(write =>
    write.id === 'pty-2' && /^\x1b\[\d+;\d+R$/.test(String.fromCharCode(...write.bytes))))).toBe(true);
  await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\r\ninactive output, Task complete is just terminal text\r\n'));
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.filter(value => value.id === 'pty-1').length)).toBeGreaterThan(1);
  for (let index = 0; index < 4; index++) {
    await page.locator(`[data-runner-id="${firstId}"] .nav-row`).click();
    await expect(page.locator('.xterm-rows')).toContainText('inactive output');
    await expect(composer).toHaveValue('first line\n안녕 🌍');
    expect(await page.evaluate(() => document.querySelector('.xterm') === window.__firstTerminal)).toBe(true);
    await page.locator(`[data-runner-id="${secondId}"] .nav-row`).click();
  }
  await page.locator(`[data-runner-id="${firstId}"] .nav-row`).click();
  await foreground(page, 'pty-1', true);
  await page.evaluate(() => window.__nativeFixture.pauseWrites());
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(composer).toBeDisabled();
  await page.locator(`[data-runner-id="${secondId}"] .nav-row`).click();
  await expect(composer).toBeEnabled();
  await page.locator(`[data-runner-id="${firstId}"] .nav-row`).click();
  await expect(composer).toHaveValue('first line\n안녕 🌍');
  await expect(composer).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__nativeFixture.resumeWrites());
  await expect(composer).toHaveValue('');
  const sent = records(await page.evaluate(() => window.__nativeFixture.writes), 'pty-1').filter(record => record.down);
  expect(sent.filter(record => record.vk === 13 && record.modifiers === 0)).toHaveLength(1);
  expect(sent.at(-1)).toMatchObject({ vk: 13, char: 13, modifiers: 0 });
  expect(sent.slice(0, -1).map(record => record.vk === 13 && record.modifiers === 16 ? '\n' : String.fromCharCode(record.char)).join('')).toBe('first line\n안녕 🌍');
  await page.locator('.xterm-helper-textarea').press('Shift+Enter');
  const physical = records(await page.evaluate(() => window.__nativeFixture.writes), 'pty-1');
  expect(physical.some(record => record.down && record.vk === 13 && record.modifiers === 16)).toBe(true);
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.resizes.length)).toBeGreaterThan(1);
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(3);
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
  await testInfo.attach('persistent-black-terminal', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Terminate Runner', exact: true }).click();
  await expect(page.getByText('Process exited (1)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
  await page.locator(`[data-runner-id="${secondId}"] .nav-row`).click();
  await expect(composer).toBeEnabled();
  await composer.fill('/status'); await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(composer).toHaveValue('');
  expect(records(await page.evaluate(() => window.__nativeFixture.writes), 'pty-2').filter(record => record.down).map(record => String.fromCharCode(record.char)).join('')).toBe('/status\r');
  await expect(page.getByRole('navigation').locator('.nav-row').first()).toHaveAccessibleName('Single Entry');
});

test('configuration failure, launch failure and unexpected exit stay local to their affected context', async ({ page }) => {
  await transport(page); await page.goto('/');
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/missing');
  await page.getByRole('button', { name: 'Verify and Start', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('native bootstrap');
  await expect(page.getByRole('button', { name: 'New Runner', exact: true })).toBeDisabled();
  await expect(page.locator('.runner-row')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
  await page.getByRole('button', { name: 'Verify and Start', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.acknowledgements.length)).toBeGreaterThan(0);
  await create(page);
  const firstId = await page.locator('.runner-row').first().getAttribute('data-runner-id');
  await page.evaluate(() => {
    window.__nativeFixture.sessions.get('pty-2').control.state = 'disconnected';
    window.__nativeFixture.failNext();
  });
  await page.waitForFunction(() => JSON.parse(window.__nativeFixture.observed.get('pty-2') ?? '{}').state === 'disconnected');
  await page.getByRole('button', { name: 'New Runner', exact: true }).click();
  await expect(page.getByText('Launch failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('fixture process launch failed');
  await page.locator(`[data-runner-id="${firstId}"] .nav-row`).click();
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeFixture.exit('pty-1', 23));
  await expect(page.getByText('Process exited (23)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-2']);
});
