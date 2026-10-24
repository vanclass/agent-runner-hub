import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test.setTimeout(90_000);
test.use({ navigationTimeout: 60_000 });

async function transport(page) {
  await page.addInitScript(() => {
    const sessions = new Map();
    const callbacks = new Map(), listeners = new Map();
    const writes = [], resizes = [], acknowledgements = [], closed = [], commands = [];
    const canonical = id => ({ run_mode: 'task-run', target: { binding_state: 'bound', owner: 'Project', project: id },
      selection: { account: id, model: 'effective-model', reasoning_effort: 'medium', service_tier: 'default', source: 'execution',
        next_model: 'configured-model', next_reasoning_effort: 'high', next_service_tier: 'default' },
      execution: { lifecycle_state: 'INTERACTIVE_READY', owned_execution_alive: false, workflow_kind: '' },
      attention: { foreground_interaction_active: false },
      commands: ['/status', '/target', '/model', '/account', '/run-mode', '/files', '/resume'].map(text => ({
        id: text, text, aliases: [], parent_id: null, visible: true, enabled: text !== '/resume',
        disabled_reason: text === '/resume' ? 'No suspended execution' : '', description: text, children: [],
      })) });
    let count = 0, callback = 0, failNext = false;
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
        if (command === 'pty_write') { writes.push({ id: args.id, bytes: args.bytes }); if (writeGate) await writeGate; return; }
        if (command === 'runner_observe') return sessions.get(args.id).control;
        if (command === 'runner_command') {
          commands.push(args);
          const control = sessions.get(args.id).control;
          control.results = [{ id: commands.length, command: args.command, state: 'queued' }];
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
      count: () => count, failNext: () => { failNext = true; } };
  });
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

test('canonical settings, terminal interactions and uncertain commands stay per session', async ({ page }, testInfo) => {
  await transport(page); await configure(page); await create(page);
  await expect(page.getByRole('button', { name: 'Change Runner Project / Target' })).toHaveText('Project / pty-1');
  await expect(page.getByText(/Next configured: configured-model/)).toBeVisible();
  await page.getByRole('button', { name: 'Change Runner Model', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Queued' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([{ id: 'pty-1', command: '/model' }]);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.results[0].state = 'pending-interaction'; });
  await expect(page.getByText(/Waiting for answers or confirmation/)).toBeVisible();
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
      results: [{ id: 1, command: '/model', state: 'accepted' }] });
  });
  await expect(page.getByText('Process exited (0)', { exact: true })).toBeVisible();
  await expect(page.getByText(/Completed · accepted by Runner/)).toBeVisible();
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
