import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test.setTimeout(90_000);
test.use({ navigationTimeout: 60_000 });

async function transport(page, freshTarget) {
  await page.addInitScript(freshTarget => {
    const sessions = new Map();
    const callbacks = new Map(), listeners = new Map();
    const writes = [], resizes = [], acknowledgements = [], closed = [], commands = [];
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
    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: handler => { callbacks.set(++callback, handler); return callback; },
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === 'runner_resolve') {
          if (args.location === '/missing') throw new Error('Runner managed Python is missing. Run native bootstrap.');
          return { root: '/fixture/install', python: '/fixture/python' };
        }
        if (command === 'pty_open') {
          count++;
          if (failNext) { failNext = false; throw new Error('fixture process launch failed'); }
          if (args.request.runnerLocation !== '/fixture/install') throw new Error('Wrong configured installation');
          const id = `pty-${count}`;
          sessions.set(id, { channel: args.onEvent, sequence: 0, control: { state: 'ready', observation: canonical(id), results: [] } });
          setTimeout(() => emit(id, `\x1b[?9001h\x1b[?2004h\x1b[32m${id}: 안녕 🌍\x1b[0m\r\n`), 10);
          return id;
        }
        if (command === 'pty_write') {
          writes.push({ id: args.id, bytes: args.bytes });
          if (writeGate) await writeGate;
          if (failWrite) { failWrite = false; throw new Error('fixture PTY write failed'); }
          return;
        }
        if (command === 'runner_observe') {
          if (sessions.get(args.id).control.age) window.__nativeFixture.observedStale = true;
          return { ...sessions.get(args.id).control, observationSerial: ++serial,
            observationAgeMs: sessions.get(args.id).control.age ?? 0 };
        }
        if (command === 'runner_command') {
          commands.push(args);
          const control = sessions.get(args.id).control;
          control.results = [{ id: commands.length, command: args.command, state: 'queued', changed: true }];
          return;
        }
        if (command === 'plugin:dialog|open') return args.options.directory ? '/fixture/folder' : ['/fixture/image.png'];
        if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'pty_resize') { resizes.push(args); return; }
        if (command === 'pty_ack') { acknowledgements.push(args); return; }
        if (command === 'pty_close') { closed.push(args.id); exit(args.id, 1); return; }
        throw new Error(`Unexpected native fixture command: ${command}`);
      },
    };
    window.__nativeFixture = { sessions, writes, resizes, acknowledgements, closed, commands, emit, exit,
      drop: paths => { for (const [id, event] of listeners) if (event === 'tauri://drag-drop') callbacks.get(id)({ event, id, payload: { paths, position: { x: 0, y: 0 } } }); },
      pauseWrites: () => { writeGate = new Promise(resolve => { releaseWrite = resolve; }); },
      resumeWrites: () => { writeGate = undefined; releaseWrite(); },
      count: () => count, failNext: () => { failNext = true; }, failWrite: () => { failWrite = true; },
      readyNew: () => { alignNew = true; } };
  }, freshTarget);
}

async function configure(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
  await page.getByRole('button', { name: 'Verify installation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Runner', exact: true })).toBeEnabled();
}
async function create(page) {
  await page.getByRole('button', { name: 'New Runner', exact: true }).click();
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
}

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
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(5);
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
    const current = page.getByRole('button', { name: 'Change Runner Project / Target', exact: true });
    await expect(current).toHaveText('Project / Historical A');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
    expect(saved.tabs[0].lastVerified).toEqual(historical);
    expect(saved.tabs[0].recoveryHint).toBeUndefined();
    for (let reopening = 0; reopening < 3; reopening++) {
      await page.reload();
      await expect(page.locator('.runner-row')).toHaveCount(1);
      await page.locator('.runner-row .nav-row').click();
      await expect(current).toHaveText(target.project ? 'Project / Fresh B' : 'Unbound');
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
      expect(persisted.tabs[0].id).toBe(saved.tabs[0].id);
      expect(persisted.tabs[0].createdOrder).toBe(saved.tabs[0].createdOrder);
      expect(persisted.tabs[0].lastVerified).toEqual({ target, runMode: 'task-run', workflowKind: '' });
      const recovery = page.getByLabel('Restored Runner recovery');
      await expect(recovery).toContainText('Historical target: Project / Historical A');
      expect(persisted.tabs[0].recoveryHint).toEqual(historical);
      await expect(recovery).toContainText('Previous run mode: issue-run');
      await expect(recovery).toContainText('Previous workflow: IssueRun');
      await expect(page.getByRole('button', { name: 'Change Runner Run Mode', exact: true })).toHaveText('task-run');
      await expect(recovery).toContainText('Historical work recovery is unconfirmed');
      expect(await page.evaluate(() => [window.__nativeFixture.writes, window.__nativeFixture.commands])).toEqual([[], []]);
      if (reopening === 0) {
        await current.click();
        await page.evaluate(() => {
          const control = window.__nativeFixture.sessions.get('pty-1').control;
          control.observation.target = { binding_state: 'bound', owner: 'Project', project: 'Changed C' };
          control.observation.run_mode = 'direct-run';
          control.results = [{ id: 1, command: '/target', state: 'accepted', changed: true }];
          control.observation.commands.push({ id: 'recover', text: '/recover', aliases: [], parent_id: null,
            visible: true, enabled: true, disabled_reason: '', description: 'Discover work', children: [] });
        });
        await expect(current).toHaveText('Project / Changed C');
        await expect(page.getByRole('button', { name: 'Change Runner Run Mode', exact: true })).toHaveText('direct-run');
        await page.getByRole('button', { name: 'Recover earlier work', exact: true }).click();
        await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.results = [
          { id: 2, command: '/recover', state: 'accepted', code: 'SUCCESS' }]; });
        await expect(recovery).toContainText('/recover: accepted (SUCCESS)');
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
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(3);
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
    await page.goto('/');
    await expect(page.getByRole('alert').filter({ hasText: 'Workspace restoration unavailable' })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'))).toBe(raw);
  });
}

test('workspace retains the last atomic commit when storage rejects a write', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.reload();
  await page.locator('.runner-row .nav-row').click();
  await expect(page.getByRole('button', { name: 'Change Runner Project / Target', exact: true })).toHaveText('Project / pty-1');
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
  await page.goto('/');
  await expect(page.locator('.runner-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')));
  expect(Object.keys(stored.tabs[0]).sort()).toEqual(['createdOrder', 'id', 'installationRoot', 'launchOnOpen', 'name', 'recoveryHint']);
  expect(stored.tabs[0].recoveryHint).toEqual({ target: { binding_state: 'bound', owner: 'Project', project: 'Retained A' },
    runMode: 'task-run', workflowKind: 'TaskRun' });
  await page.locator('.runner-row .nav-row').click();
  await expect(page.getByLabel('Restored Runner recovery')).toContainText('Historical target: Project / Retained A');
  await expect(page.getByRole('button', { name: 'Change Runner Project / Target', exact: true })).not.toContainText('Retained A');
  await expect(page.getByRole('button', { name: 'Change Runner Project / Target', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Recover earlier work', exact: true })).toBeDisabled();
});

test('workspace drops an uncertain Single Entry submission on reopening', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await entry(page, 'WG6 uncertain instruction');
  await page.evaluate(() => window.__nativeFixture.failWrite());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'automatic retry and reassignment are blocked' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'))).not.toContain('WG6 uncertain instruction');
  await page.reload();
  await expect(page.locator('.runner-row')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => [window.__nativeFixture.writes, window.__nativeFixture.commands])).toEqual([[], []]);
});

test('Single Entry creates when no eligible idle Runner exists', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.execution.owned_execution_alive = true; });
  await entry(page);
  await page.evaluate(() => window.__nativeFixture.readyNew());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
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
    if (['disconnected', 'unknown', 'stale'].includes(exclusion)) {
      await page.locator('.runner-row').first().locator('.nav-row').click();
      if (exclusion !== 'stale') await expect(page.locator('.runner-controls .control-status')).toContainText(exclusion === 'disconnected'
        ? 'Control disconnected' : 'Outcome unknown');
      else await expect.poll(() => page.evaluate(() => window.__nativeFixture.observedStale)).toBeTruthy();
    }
    await entry(page);
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
    expect((await page.evaluate(() => window.__nativeFixture.writes)).map(w => w.id)).toEqual(['pty-2']);
  });
}

test('Single Entry keeps unsupported settings unsent and can transfer the known-unsent draft', async ({ page }, testInfo) => {
  await transport(page); await configure(page); await create(page); await create(page);
  await entry(page, 'held instruction');
  await page.getByRole('combobox', { name: 'Single Entry Account', exact: true }).selectOption(JSON.stringify('pty-2'));
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Settings need terminal interaction: /account' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
  await testInfo.attach('single-entry-settings-incomplete', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Open assigned Runner' }).click();
  await page.getByRole('button', { name: 'Change Runner Account' }).click();
  await expect(page.getByText(/Queued · no completed change yet/)).toBeVisible();
  await page.evaluate(() => {
    const c = window.__nativeFixture.sessions.get('pty-1').control;
    c.results[0] = { ...c.results[0], state: 'rejected', ownerStatus: 'CANCELLED', changed: false };
  });
  await expect(page.getByText('Cancelled in terminal · No settings changed')).toBeVisible();
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions' })).toHaveValue('held instruction');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  await page.getByRole('button', { name: 'Move unsent instruction to Runner' }).click();
  await page.getByRole('button', { name: 'Open assigned Runner' }).click();
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('held instruction');
  await expect(page.getByRole('button', { name: 'Change Runner Account' })).toHaveText('pty-1');
});

test('Single Entry write failure remains ambiguous without replay or reassignment', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await entry(page); await page.evaluate(() => window.__nativeFixture.failWrite());
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('automatic retry and reassignment are blocked');
  await page.getByRole('button', { name: 'Open assigned Runner' }).click();
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('/status');
  await expect(page.getByRole('button', { name: 'Assign instruction' })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
});

test('Single Entry launch failure retains its draft without retry', async ({ page }) => {
  await transport(page); await configure(page);
  await page.getByRole('textbox', { name: 'Single Entry instructions' }).fill('/status');
  await page.evaluate(() => window.__nativeFixture.failNext());
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'fixture process launch failed' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions' })).toHaveValue('/status');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
});

test('Single Entry process exit during readiness leaves the instruction unsent', async ({ page }) => {
  await transport(page); await configure(page); await create(page); await entry(page);
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await page.evaluate(() => window.__nativeFixture.exit('pty-1', 7));
  await expect(page.getByRole('status').filter({ hasText: /Runner process exited|Instruction unsent/ })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
});

test('Single Entry confirms selected defaults and excludes a delivered but unacknowledged session', async ({ page }) => {
  await transport(page); await configure(page); await create(page); await create(page); await entry(page);
  await page.getByRole('combobox', { name: 'Single Entry Account', exact: true }).selectOption(JSON.stringify('pty-1'));
  await page.getByRole('combobox', { name: 'Single Entry Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Single Entry Account', exact: true }).selectOption('');
  await page.getByRole('textbox', { name: 'Single Entry instructions' }).fill('/status');
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.map(w => w.id))).toEqual(['pty-1', 'pty-2']);
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
});

test('Single Entry uses one bracketed-paste write on VT terminals', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b[?9001l'));
  await entry(page, '/hub-unknown\n안녕 🌍');
  await page.getByRole('button', { name: 'Assign instruction' }).click();
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
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
});

test('terminal color, cursor, device and focus replies preserve idle input ownership', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b]10;?\x07\x1b[5n\x1b[6n\x1b[c\x1b[?1004h'));
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
  await entry(page);
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(1);
  const writes = await page.evaluate(() => window.__nativeFixture.writes);
  expect(records(writes, 'pty-1').map(record => record.char)).toEqual([47, 115, 116, 97, 116, 117, 115, 13]);
});

test('manual terminal input remains ineligible and is never appended to by assignment', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.locator('.xterm-helper-textarea').press('x');
  await entry(page); await page.evaluate(() => window.__nativeFixture.readyNew());
  await page.getByRole('button', { name: 'Assign instruction' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  const writes = await page.evaluate(() => window.__nativeFixture.writes);
  expect(records(writes, 'pty-1').some(record => record.char === 47)).toBe(false);
  expect(records(writes, 'pty-2').map(record => record.char)).toEqual([47, 115, 116, 97, 116, 117, 115, 13]);
});

async function entry(page, text = '/status') {
  await page.evaluate(() => { for (const { control } of window.__nativeFixture.sessions.values()) {
    const s = control.observation.selection;
    s.next_model = s.model; s.next_reasoning_effort = s.reasoning_effort; s.next_service_tier = s.service_tier;
  } });
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill(text);
}

test('Single Entry reserves the first idle Runner and delivers Unicode once across tabs', async ({ page }, testInfo) => {
  await transport(page); await configure(page); await create(page); await create(page);
  await entry(page, 'first line\n안녕 🌍');
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
  expect(records(writes, 'pty-1').map(r => r.char)).toEqual([...'first line'].map(c => c.charCodeAt(0)).concat(13, '안'.charCodeAt(0), '녕'.charCodeAt(0), 32, 0xd83c, 0xdf0d, 13));
  await testInfo.attach('single-entry-delivered', { body: await page.screenshot(), contentType: 'image/png' });
});

test('canonical settings, terminal interactions and uncertain commands stay per session', async ({ page }, testInfo) => {
  await transport(page); await configure(page); await create(page);
  await expect(page.getByRole('button', { name: 'Change Runner Project / Target' })).toHaveText('Project / pty-1');
  await expect(page.getByText(/Next configured: configured-model/)).toBeVisible();
  await page.getByRole('button', { name: 'Change Runner Model', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Queued' })).toBeVisible();
  await expect(page.getByText('Settings changed', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([{ id: 'pty-1', command: '/model' }]);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.results[0].state = 'pending-interaction'; });
  await expect(page.getByText(/Waiting for answers or confirmation/)).toBeVisible();
  await expect(page.getByText('Settings changed', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
  await create(page);
  await expect(page.getByRole('button', { name: 'Change Runner Account' })).toHaveText('pty-2');
  await page.evaluate(() => { const c = window.__nativeFixture.sessions.get('pty-1').control; c.state = 'disconnected'; c.results[0].state = 'outcome-unknown'; });
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.getByText(/Control disconnected/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change Runner Model', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toHaveLength(1);
  await testInfo.attach('canonical-controls', { body: await page.screenshot(), contentType: 'image/png' });
});

test('process exit preserves a completed native command result between snapshot polls', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Change Runner Model', exact: true }).click();
  await expect(page.getByText(/Queued/)).toBeVisible();
  await page.evaluate(() => {
    const c = window.__nativeFixture.sessions.get('pty-1').control;
    window.__nativeFixture.exit('pty-1', 0, { ...c, state: 'disconnected',
      results: [{ id: 1, command: '/model', state: 'accepted', ownerStatus: 'SETTINGS_CHANGED', changed: true, settingsChangeCount: 1 }] });
  });
  await expect(page.getByText('Process exited (0)', { exact: true })).toBeVisible();
  await expect(page.getByText(/Completed · accepted by Runner/)).toBeVisible();
  await expect(page.getByText('Settings changed · Settings changes: 1', { exact: true })).toBeVisible();
  await expect(page.getByText(/Outcome unknown/)).toHaveCount(0);
});

test('selected paths remain unregistered and unsupported media is explicit', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Selected path /fixture/image.png', exact: true })).toHaveValue('/fixture/image.png');
  await expect(page.getByText(/Selected paths are not confirmed attachments/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clipboard image unavailable' })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  await create(page);
  await page.evaluate(() => window.__nativeFixture.drop(['/fixture/dropped.png']));
  await expect(page.getByRole('textbox', { name: 'Selected path /fixture/dropped.png', exact: true })).toHaveValue('/fixture/dropped.png');
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.getByRole('textbox', { name: 'Selected path /fixture/image.png', exact: true })).toHaveValue('/fixture/image.png');
  await expect(page.getByRole('textbox', { name: 'Selected path /fixture/dropped.png', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Attach folder', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Selected path /fixture/folder', exact: true })).toHaveValue('/fixture/folder');
  await page.getByRole('button', { name: 'Open /files in terminal' }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.commands)).toEqual([{ id: 'pty-1', command: '/files' }]);
  await expect(page.locator('.runner-references img')).toHaveCount(0);
});

test('shortcut preferences preserve canonical availability and stay local across tabs', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  await expect(page.locator('.shortcut-bar').getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
  await expect(page.locator('.shortcut-bar button').filter({ hasText: /^$/ })).toHaveCount(0);
  await expect(page.locator('.shortcut-bar').getByRole('button', { name: '/resume', exact: true })).toBeDisabled();
  await expect(page.locator('.shortcut-bar')).toContainText('No suspended execution');
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  await page.getByRole('checkbox', { name: '/status', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Move /model up', exact: true }).click();
  await expect(page.locator('.shortcut-bar button').first()).toHaveText('/model');
  await create(page);
  await expect(page.locator('.shortcut-bar button').first()).toHaveText('/status');
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.locator('.shortcut-bar').getByRole('button', { name: '/status', exact: true })).toHaveCount(0);
  await page.evaluate(() => { const c = window.__nativeFixture.sessions.get('pty-1').control.observation.commands; c.find(v => v.text === '/resume').enabled = true; c.find(v => v.text === '/resume').disabled_reason = ''; });
  await expect(page.locator('.shortcut-bar').getByRole('button', { name: '/resume', exact: true })).toBeEnabled();
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
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.resizes.length)).toBeGreaterThan(1);
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.count())).toBe(2);
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
  await testInfo.attach('persistent-black-terminal', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Terminate Runner', exact: true }).click();
  await expect(page.getByText('Process exited (1)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
  await page.locator(`[data-runner-id="${secondId}"] .nav-row`).click();
  await expect(composer).toBeEnabled();
  await composer.fill('/status'); await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  expect(records(await page.evaluate(() => window.__nativeFixture.writes), 'pty-2').filter(record => record.down).map(record => String.fromCharCode(record.char)).join('')).toBe('/status\r');
  await expect(page.getByRole('navigation').locator('.nav-row').first()).toHaveAccessibleName('Single Entry');
});

test('configuration failure, launch failure and unexpected exit stay local to their affected context', async ({ page }) => {
  await transport(page); await page.goto('/');
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/missing');
  await page.getByRole('button', { name: 'Verify installation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('native bootstrap');
  await expect(page.getByRole('button', { name: 'New Runner', exact: true })).toBeDisabled();
  await expect(page.locator('.runner-row')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
  await page.getByRole('button', { name: 'Verify installation', exact: true }).click();
  await create(page);
  const firstId = await page.locator('.runner-row').first().getAttribute('data-runner-id');
  await page.evaluate(() => window.__nativeFixture.failNext());
  await page.getByRole('button', { name: 'New Runner', exact: true }).click();
  await expect(page.getByText('Launch failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('fixture process launch failed');
  await page.locator(`[data-runner-id="${firstId}"] .nav-row`).click();
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeFixture.exit('pty-1', 23));
  await expect(page.getByText('Process exited (23)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
});
