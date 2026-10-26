import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';

test.setTimeout(90_000);
test.use({ navigationTimeout: 60_000 });

async function transport(page, freshTarget, referenceOptions) {
  await page.addInitScript(({ freshTarget, referenceOptions }) => {
    const sessions = new Map();
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
          return { root: '/fixture/install', python: '/fixture/python' };
        }
        if (command === 'pty_open') {
          count++;
          if (failNext) { failNext = false; throw new Error('fixture process launch failed'); }
          if (args.request.runnerLocation !== '/fixture/install') throw new Error('Wrong configured installation');
          const id = `pty-${count}`;
          sessions.set(id, { channel: args.onEvent, sequence: 0, control: { state: 'ready', observation: canonical(id), results: [],
            clipboardStaging: !!referenceOptions?.clipboard } });
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
          if (sessions.get(args.id).control.age) window.__nativeFixture.observedStale = true;
          return { ...sessions.get(args.id).control, observationSerial: ++serial,
            observationAgeMs: sessions.get(args.id).control.age ?? 0 };
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
    window.__nativeFixture = { sessions, writes, resizes, acknowledgements, closed, commands, emit, exit,
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

async function configure(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'AgentRunner location', exact: true }).fill('/fixture/install');
  await page.getByRole('button', { name: 'Verify installation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Runner', exact: true })).toBeEnabled();
}

function generatedFixture() {
  // Synthetic PNG and delivery boundary; never genuine Codex generation evidence.
  const png = PNG.sync.write({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) });
  const image = { sourceSequence: 1, outputIndex: 0, source: 'codex.imageGeneration', mimeType: 'image/png',
    byteLength: png.length, sha256: createHash('sha256').update(png).digest('hex'), width: 2, height: 1 };
  return { generatedImages: [image, { ...image, sourceSequence: 2 }], generatedPng: [...png] };
}

test('generated image reads retain their original owner across asynchronous tab switches', async ({ page }) => {
  await transport(page, undefined, { ...generatedFixture(), pauseFirstImage: true }); await configure(page); await create(page);
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'loading');
  const firstId = await page.getByRole('combobox', { name: 'Select generated image' }).inputValue();
  await create(page); const image = page.getByRole('img', { name: 'Verified generated image', exact: true });
  await expect(image).toBeVisible(); const secondUrl = await image.getAttribute('src');
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').releaseImage());
  await expect(image).toHaveAttribute('src', secondUrl);
  expect(await page.getByRole('combobox', { name: 'Select generated image' }).inputValue()).not.toBe(firstId);
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.getByRole('combobox', { name: 'Select generated image' })).toHaveValue(firstId);
  await expect(image).toBeVisible(); await expect(image).not.toHaveAttribute('src', secondUrl);
});

test('generated image resources revoke on selection and owned exit without affecting another live Runner', async ({ page }) => {
  await page.addInitScript(() => { const original = URL.revokeObjectURL.bind(URL); window.__revokedImages = [];
    URL.revokeObjectURL = url => { window.__revokedImages.push(url); original(url); }; });
  await transport(page, undefined, generatedFixture()); await configure(page); await create(page);
  const image = page.getByRole('img', { name: 'Verified generated image', exact: true }); await expect(image).toBeVisible();
  const original = await image.getAttribute('src');
  await page.getByRole('combobox', { name: 'Select generated image' }).selectOption({ index: 1 }); await expect(image).toBeVisible();
  await expect.poll(() => page.evaluate(url => window.__revokedImages.includes(url), original)).toBe(true);
  const first = await image.getAttribute('src'); await create(page); await expect(image).toBeVisible();
  const second = await image.getAttribute('src'); await page.evaluate(() => window.__nativeFixture.exit('pty-1'));
  await expect.poll(() => page.evaluate(url => window.__revokedImages.includes(url), first)).toBe(true);
  expect(await page.evaluate(url => window.__revokedImages.includes(url), second)).toBe(false);
  await expect(image).toHaveAttribute('src', second);
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-2').control.generatedImagesSupported = false; });
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'unsupported');
  await expect.poll(() => page.evaluate(url => window.__revokedImages.includes(url), second)).toBe(true);
});

test('generated image states reject unavailable sources and discard late reads after Runner exit', async ({ page }) => {
  await transport(page, undefined, generatedFixture()); await configure(page); await create(page);
  await expect(page.getByRole('img', { name: 'Verified generated image', exact: true })).toBeVisible();
  await page.evaluate(() => { const a = window.__nativeFixture.sessions.get('pty-1');
    a.imageFailure = { state: 'unavailable', detail: 'Fixture image expired' }; });
  await page.getByRole('button', { name: 'Refresh images' }).click();
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('.generated-image-preview')).toHaveCount(0);
  await page.evaluate(() => { const a = window.__nativeFixture.sessions.get('pty-1'); a.imageFailure = undefined; a.images = []; });
  await page.getByRole('button', { name: 'Refresh images' }).click();
  await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'empty');
  await create(page); await expect(page.getByRole('img', { name: 'Verified generated image', exact: true })).toBeVisible();
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
  await transport(page, undefined, generatedFixture()); await configure(page); await create(page);
  const image = page.getByRole('img', { name: 'Verified generated image', exact: true });
  await expect(image).toBeVisible();
  expect(await image.evaluate(element => element.naturalWidth)).toBe(2);
  const firstUrl = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Enlarge generated image' }).click();
  await expect(page.getByRole('dialog', { name: 'Enlarged generated image' })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('combobox', { name: 'Select generated image' }).selectOption({ index: 1 });
  await expect(image).toBeVisible(); await expect(image).not.toHaveAttribute('src', firstUrl);
  await create(page); await expect(image).toBeVisible(); const secondUrl = await image.getAttribute('src');
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(image).toBeVisible(); await expect(image).not.toHaveAttribute('src', secondUrl);
  await page.getByRole('button', { name: 'Refresh images' }).click(); await expect(image).toBeVisible();
  expect(await page.locator('.terminal-host').evaluate(element => !!element.querySelector('.xterm'))).toBe(true);
  await testInfo.attach('synthetic-generated-image-preview', { body: await page.screenshot(), contentType: 'image/png' });
});

test('reference extension keeps duplicate picker identities and reconciles complete paginated inventory', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  for (let n = 0; n < 3; n++) {
    await page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await expect(page.locator('.reference-candidate').filter({ hasText: 'Registered · completed Runner receipt' })).toHaveCount(n + 1);
  }
  const ids = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.map(item => item.reference_id));
  expect(new Set(ids).size).toBe(3);
  await page.getByRole('button', { name: 'Reconcile pending references' }).click();
  await expect(page.getByRole('region', { name: 'Registered pending references' }).locator('li code')).toHaveText(ids);
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.shift());
  await expect(page.getByRole('button', { name: 'Reconcile pending references' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reconcile pending references' }).click();
  await expect(page.getByRole('region', { name: 'Registered pending references' }).locator('li code')).toHaveText(ids.slice(1));
});

test('clipboard capture stages independent previews, cancels B, and sends only A C D E in order', async ({ page }, testInfo) => {
  await transport(page, undefined, { clipboard: true, auto: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  for (let n = 0; n < 3; n++) {
    await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
    await expect(page.locator('.clipboard-candidate img')).toHaveCount(n + 1);
  }
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toHaveLength(0);
  const cancelledPreview = await page.getByAltText('Clipboard image 2 preview').getAttribute('src');
  await page.getByRole('button', { name: 'Cancel image 2', exact: true }).click();
  await expect(page.locator('.clipboard-candidate img')).toHaveCount(2);
  expect(await page.evaluate(url => window.__nativeFixture.revokedUrls.includes(url), cancelledPreview)).toBe(true);
  for (let n = 0; n < 2; n++) {
    await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
    await expect(page.locator('.clipboard-candidate img')).toHaveCount(n + 3);
  }
  await page.screenshot({ path: testInfo.outputPath('clipboard-selection.png'), fullPage: true });
  await page.locator('.reference-candidate').filter({ has: page.getByAltText('Clipboard image 1 preview') })
    .screenshot({ path: testInfo.outputPath('clipboard-item.png') });
  await page.getByLabel('Runner instructions', { exact: true }).fill('Inspect these four selected images');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('');
  const outcome = await page.evaluate(() => {
    const f = window.__nativeFixture;
    const registrations = f.referenceRequests.filter(item => item.request.operation === 'references.register');
    const instruction = f.deliveredSets.filter(item => new TextDecoder().decode(new Uint8Array(item.bytes)).endsWith('\u001b[13;0;13;1;0;1_'));
    return { registrations: registrations.map(item => [item.id, item.request.path]), ids: f.sessions.get('pty-1').items.map(item => item.reference_id),
      instruction, persisted: localStorage.getItem('agent-runner-hub.workspace.v1') ?? '', closes: f.imageCloses, reads: f.clipboardReads.length };
  });
  expect(outcome.registrations).toEqual([1, 3, 4, 5].map(n => ['pty-1', `/fixture/hub-owned/pty-1/clipboard-${n}.png`]));
  expect(outcome.ids).toHaveLength(4); expect(new Set(outcome.ids).size).toBe(4);
  expect(outcome.instruction).toHaveLength(1); expect(outcome.instruction[0].ids).toEqual(outcome.ids);
  expect(outcome.persisted).not.toContain('clipboard-'); expect(outcome.persisted).not.toContain('blob:');
  expect(outcome.reads).toBe(5); expect(outcome.closes).toHaveLength(5);
  await expect(page.locator('.clipboard-candidate img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear registration history' }).click();
  await expect(page.locator('.reference-candidate')).toHaveCount(0);
});

test('clipboard capture retains its originating session across tab switches and cancellation during capture', async ({ page }) => {
  await transport(page, undefined, { clipboard: true, auto: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.pauseStage());
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByText('Reading clipboard and staging PNG for this Runner…')).toBeVisible();
  await create(page);
  await page.evaluate(() => window.__nativeFixture.resumeStage());
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.getByAltText('Clipboard image 1 preview')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.staged.map(item => item.id))).toEqual(['pty-1']);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toHaveLength(0);
  await page.evaluate(() => window.__nativeFixture.pauseStage());
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel image 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel image 2', exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.resumeStage());
  await expect(page.locator('.reference-candidate').filter({ hasText: 'Cancelled' })).toHaveCount(1);
  await expect(page.locator('.clipboard-candidate img')).toHaveCount(1);
});

test('empty clipboard and staging failures stay actionable and unknown registration never replays', async ({ page }) => {
  await transport(page, undefined, { clipboard: true, unknownAdmission: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.missingImage(true));
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Copy a supported image' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel image 1', exact: true }).click();
  await page.evaluate(() => { window.__nativeFixture.missingImage(false); window.__nativeFixture.stageFailure(true); });
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel image 2', exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.stageFailure(false));
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByAltText('Clipboard image 3 preview')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toHaveLength(0);
  await page.getByLabel('Runner instructions', { exact: true }).fill('Keep the uncertain draft');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'registration did not complete' })).toBeVisible();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('Keep the uncertain draft');
  await page.getByRole('button', { name: 'Clear registration history' }).click();
  await expect(page.locator('.reference-candidate')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'unresolved' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register'))).toHaveLength(1);
  expect(await page.evaluate(() => window.__nativeFixture.deliveredSets.filter(item => new TextDecoder().decode(new Uint8Array(item.bytes)).endsWith('\u001b[13;0;13;1;0;1_')))).toHaveLength(0);
});

test('clipboard stays unavailable without native staging or during foreground interaction', async ({ page }) => {
  await transport(page, undefined, { clipboard: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  const capture = page.getByRole('button', { name: 'Clipboard image', exact: true });
  await expect(capture).toBeEnabled();
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.attention.foreground_interaction_active = true; });
  await expect(capture).toBeDisabled();
  await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.clipboardStaging = false; });
  await expect(page.getByRole('button', { name: 'Clipboard image unavailable', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.clipboardReads.length)).toBe(0);
});

async function create(page) {
  await page.getByRole('button', { name: 'New Runner', exact: true }).click();
  await expect(page.getByText('Process running', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
}

test('later clipboard registration failure holds the exact draft and selection without partial instruction delivery', async ({ page }) => {
  await transport(page, undefined, { clipboard: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  for (let n = 0; n < 3; n++) {
    await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
    await expect(page.locator('.clipboard-candidate img')).toHaveCount(n + 1);
  }
  await page.getByLabel('Runner instructions', { exact: true }).fill('Keep this exact draft');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register').length)).toBe(1);
  await expect(page.getByLabel('Runner instructions', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clipboard image', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel image 2', exact: true })).toBeDisabled();
  await page.evaluate(() => { const f = window.__nativeFixture; const request = f.referenceRequests.find(item => item.request.operation === 'references.register');
    f.finishReference(request.id, request.requestId); });
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register').length)).toBe(2);
  await page.evaluate(() => { const f = window.__nativeFixture; const request = f.referenceRequests.filter(item => item.request.operation === 'references.register')[1];
    f.finishReference(request.id, request.requestId, 'rejected'); });
  await expect(page.getByRole('alert').filter({ hasText: 'registration did not complete' })).toBeVisible();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('Keep this exact draft');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(0);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register'))).toHaveLength(2);
  await page.getByRole('button', { name: 'Cancel image 2', exact: true }).click();
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register').length)).toBe(3);
  await page.evaluate(() => { const f = window.__nativeFixture; const request = f.referenceRequests.filter(item => item.request.operation === 'references.register')[2];
    f.finishReference(request.id, request.requestId); });
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
});

test('cancelling a queued registration settles its exact attempt then removes by committed ID', async ({ page }) => {
  await transport(page, undefined, {}); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText('Queued · registration unconfirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel path 1', exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 101));
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.remove').length)).toBe(1);
  const removal = await page.evaluate(() => {
    const f = window.__nativeFixture, request = f.referenceRequests.find(item => item.request.operation === 'references.remove');
    return { request, committed: f.sessions.get('pty-1').items[0].reference_id };
  });
  expect(removal.request.request).toEqual({ operation: 'references.remove', reference_id: removal.committed });
  await page.evaluate(request => window.__nativeFixture.finishReference(request.id, request.requestId, 'outcome-unknown'), removal.request);
  await expect(page.getByText(/Outcome unknown · not repeated/)).toBeVisible();
  await page.getByLabel('Runner instructions', { exact: true }).fill('Do not send unresolved removals');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'unresolved' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(0);
  await page.evaluate(id => { const session = window.__nativeFixture.sessions.get('pty-1');
    session.items = session.items.filter(item => item.reference_id !== id); }, removal.committed);
  await page.getByRole('button', { name: 'Reconcile pending references' }).click();
  await expect(page.getByText(/Removed · owning Runner confirmed absence/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.remove'))).toHaveLength(1);
});

test('completed registration removal retains receipts and isolates independent Runner identities', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText(/Registered · completed Runner receipt/)).toBeVisible();
  await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText(/Registered · completed Runner receipt/)).toBeVisible();
  const other = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-2').items[0].reference_id);
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await page.getByRole('button', { name: 'Remove path 1', exact: true }).click();
  await expect(page.getByText(/Removed · owning Runner confirmed absence/)).toBeVisible();
  const result = await page.evaluate(() => {
    const f = window.__nativeFixture;
    return { a: f.sessions.get('pty-1').items, b: f.sessions.get('pty-2').items,
      removal: f.referenceRequests.filter(item => item.request.operation === 'references.remove'),
      receipts: f.sessions.get('pty-1').control.references.results.map(item => item.state) };
  });
  expect(result.a).toEqual([]); expect(result.b.map(item => item.reference_id)).toEqual([other]);
  expect(result.removal).toHaveLength(1); expect(result.removal[0].id).toBe('pty-1');
  expect(result.removal[0].request.reference_id).not.toBe(other);
  expect(result.receipts).toEqual(['registered', 'removed']);
});

test('legacy removal requires /files and authoritative reconciliation before ordinary submission', async ({ page }) => {
  await transport(page, undefined, { auto: true, legacyRemoval: true }); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText(/Registered · completed Runner receipt/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove path 1', exact: true }).click();
  await expect(page.getByText(/This attachment remains unresolved/)).toBeVisible();
  await page.getByLabel('Runner instructions', { exact: true }).fill('After manual removal');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'unresolved' })).toBeVisible();
  await page.getByRole('button', { name: 'Open /files in terminal' }).click();
  await page.evaluate(() => { const session = window.__nativeFixture.sessions.get('pty-1'); session.items = [];
    session.control.results.forEach(result => result.state = 'accepted'); });
  await expect(page.getByRole('button', { name: 'Reconcile pending references' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reconcile pending references' }).click();
  await expect(page.getByText(/Removed · owning Runner confirmed absence/)).toBeVisible();
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.remove'))).toHaveLength(0);
});

test('pending terminal cancellation and unknown completion remain distinct without automatic replay', async ({ page }) => {
  await transport(page, undefined, {}); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 101, 'pending-interaction'));
  await expect(page.getByText(/Pending terminal interaction · select image detail/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel path 1', exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 101, 'outcome-unknown'));
  await expect(page.getByText(/Outcome unknown · not repeated/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear registration history' }).click();
  await expect(page.locator('.reference-candidate')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reconcile pending references' }).click();
  await expect(page.getByText(/Outcome unknown · not repeated/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconcile pending references' })).toBeEnabled();
  await page.getByLabel('Runner instructions', { exact: true }).fill('Unknown registration must not send');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'unresolved' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(0);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register'))).toHaveLength(1);
});

test('preflight permits Runner-owned terminal cancellation and preserves the unsent draft', async ({ page }) => {
  await transport(page, undefined, { clipboard: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByAltText('Clipboard image 1 preview')).toBeVisible();
  await page.getByLabel('Runner instructions', { exact: true }).fill('Terminal cancellation keeps this draft');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.referenceRequests.some(item => item.request.operation === 'references.register'))).toBe(true);
  await page.evaluate(() => { const f = window.__nativeFixture, request = f.referenceRequests.find(item => item.request.operation === 'references.register');
    f.finishReference(request.id, request.requestId, 'pending-interaction'); });
  await expect(page.getByText(/Pending terminal interaction · select image detail/)).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Escape');
  await page.evaluate(() => { const f = window.__nativeFixture, request = f.referenceRequests.find(item => item.request.operation === 'references.register');
    f.finishReference(request.id, request.requestId, 'rejected');
    f.sessions.get(request.id).control.references.results.find(item => item.id === request.requestId).code = 'REFERENCE_SELECTION_CANCELLED'; });
  await expect(page.getByRole('alert').filter({ hasText: 'registration did not complete' })).toBeVisible();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('Terminal cancellation keeps this draft');
  await expect(page.getByText(/Cancelled · no pending attachment/)).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes.every(item => new TextDecoder().decode(new Uint8Array(item.bytes)).includes('[27;')))).toBe(true);
});

test('other pending references require review and remain present alongside the selected clipboard image', async ({ page }) => {
  await transport(page, undefined, { clipboard: true, auto: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.push(...[1, 2, 3].map(n => ({
    reference_id: n.toString(16).padStart(32, 'e'), display_index: n, display_name: 'terminal-' + n + '.txt', kind: 'file', image_detail: null, media_kind: null }))));
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByAltText('Clipboard image 1 preview')).toBeVisible();
  await page.getByLabel('Runner instructions', { exact: true }).fill('Include the reviewed terminal references');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Other pending references' }).locator('li')).toHaveCount(3);
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(0);
  await page.getByRole('button', { name: 'Clear registration history' }).click();
  await expect(page.getByAltText('Clipboard image 1 preview')).toBeVisible();
  await page.getByRole('button', { name: 'Include other pending references', exact: true }).click();
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.map(item => item.display_name)))
    .toEqual(['terminal-1.txt', 'terminal-2.txt', 'terminal-3.txt', 'clipboard-1.png']);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.remove'))).toHaveLength(0);
});

test('changing paginated inventory blocks without inventing a snapshot or sending an instruction', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await page.evaluate(() => { const session = window.__nativeFixture.sessions.get('pty-1');
    session.items = [1, 2, 3].map(n => ({ reference_id: n.toString(16).padStart(32, 'e'), display_index: n,
      display_name: 'terminal-' + n, kind: 'file', image_detail: null, media_kind: null })); session.changeInventoryAt = 2; });
  await page.getByLabel('Runner instructions', { exact: true }).fill('Do not send changing inventory');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'pagination is unverified' })).toBeVisible();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('Do not send changing inventory');
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(0);
});

test('ordinary PTY uncertainty preserves the draft and blocks Hub replay', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await page.getByLabel('Runner instructions', { exact: true }).fill('One uncertain ordinary delivery');
  await page.evaluate(() => window.__nativeFixture.failWrite());
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'PTY delivery outcome unknown' })).toBeVisible();
  await expect(page.getByLabel('Runner instructions', { exact: true })).toHaveValue('One uncertain ordinary delivery');
  await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toHaveLength(1);
});

test('clipboard previews revoke on owned session exit and late capture never crosses into another Runner', async ({ page }) => {
  await transport(page, undefined, { clipboard: true, auto: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByAltText('Clipboard image 1 preview')).toBeVisible();
  const firstUrl = await page.getByAltText('Clipboard image 1 preview').getAttribute('src');
  await page.evaluate(() => window.__nativeFixture.pauseStage());
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByText('Reading clipboard and staging PNG for this Runner…')).toBeVisible();
  await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  await page.evaluate(() => { window.__nativeFixture.exit('pty-1'); window.__nativeFixture.resumeStage(); });
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByAltText('Clipboard image 1 preview')).toBeVisible();
  const secondUrl = await page.getByAltText('Clipboard image 1 preview').getAttribute('src');
  expect(firstUrl).not.toBe(secondUrl);
  const released = await page.evaluate(() => window.__nativeFixture.revokedUrls);
  expect(released).toContain(firstUrl); expect(released).not.toContain(secondUrl);
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.locator('.clipboard-candidate img')).toHaveCount(0);
  await expect(page.locator('.reference-candidate').filter({ hasText: 'Cancelled' })).toHaveCount(2);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toHaveLength(0);
});

test('clipboard preview selection stays bounded and a cancelled slot can be replaced', async ({ page }) => {
  await transport(page, undefined, { clipboard: true, auto: true }); await configure(page); await create(page);
  await page.getByText('Files and images', { exact: true }).click();
  for (let n = 0; n < 16; n++) {
    await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
    await expect(page.locator('.clipboard-candidate img')).toHaveCount(n + 1);
  }
  await expect(page.getByRole('button', { name: 'Clipboard image', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel image 8', exact: true }).click();
  await page.getByRole('button', { name: 'Clipboard image', exact: true }).click();
  await expect(page.getByAltText('Clipboard image 17 preview')).toBeVisible();
  await expect(page.locator('.clipboard-candidate img')).toHaveCount(16);
  expect(await page.evaluate(() => window.__nativeFixture.staged.length)).toBe(17);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toHaveLength(0);
});

test('reference drop submissions keep individual receipts and their original Runner through tab switches', async ({ page }) => {
  await transport(page, undefined, {}); await configure(page); await create(page);
  const paths = ['C:\\참조 폴더\\input.txt', 'C:\\참조 폴더\\image.png'];
  await page.evaluate(paths => window.__nativeFixture.drop(paths), paths);
  await expect(page.getByText('Queued · registration unconfirmed', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 101, 'pending-interaction'));
  await expect(page.getByText(/Pending terminal interaction · select image detail/)).toBeVisible();
  await create(page);
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 101));
  await expect.poll(() => page.evaluate(() => window.__nativeFixture.referenceRequests.length)).toBe(2);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.map(item => [item.id, item.request.path]))).toEqual(paths.map(path => ['pty-1', path]));
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 102, 'rejected'));
  await page.locator('.runner-row').first().locator('.nav-row').click();
  await expect(page.getByText(/Registered · completed Runner receipt/)).toHaveCount(1);
  await expect(page.getByText(/Rejected · no registration confirmed/)).toHaveCount(1);
  expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-2').items)).toEqual([]);
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
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

test('uncertain reference remains explicit across clearing, refreshing and tab switches without replay', async ({ page }) => {
  await transport(page, undefined, {}); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText('Queued · registration unconfirmed', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeFixture.finishReference('pty-1', 101, 'outcome-unknown'));
  await expect(page.getByText(/Outcome unknown · not repeated/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear registration history' }).click();
  await expect(page.getByText(/Outcome unknown · not repeated/)).toBeVisible();
  await create(page); await page.locator('.runner-row').first().locator('.nav-row').click();
  await page.getByRole('button', { name: 'Reconcile pending references' }).click();
  await expect(page.getByText(/0 pending · Matching complete/)).toBeVisible();
  await expect(page.getByText(/Outcome unknown · not repeated/)).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.register'))).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Register selected paths' })).toBeDisabled();
});

test('Single Entry skips a Runner with prepared references and verifies the chosen empty inventory', async ({ page }) => {
  await transport(page, undefined, { auto: true }); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText(/Registered · completed Runner receipt/)).toBeVisible();
  await create(page); await entry(page);
  await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Delivered to PTY' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes.map(item => item.id))).toEqual(['pty-2']);
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(item => item.request.operation === 'references.list').map(item => item.id))).toEqual(['pty-2']);
  expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.length)).toBe(1);
});

test('reference admission failure is distinct from uncertainty and is never automatically retried', async ({ page }) => {
  await transport(page, undefined, { admissionFailure: true }); await configure(page); await create(page);
  await page.getByRole('button', { name: 'Attach file', exact: true }).click();
  await expect(page.getByText(/Failed · review or cancel/)).toBeVisible();
  await expect(page.getByText(/fixture queue unavailable/)).toBeVisible();
  await expect(page.getByText(/Outcome unknown · not repeated/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Register selected paths' })).toBeDisabled();
  await create(page); await page.locator('.runner-row').first().locator('.nav-row').click();
  expect(await page.evaluate(() => window.__nativeFixture.referenceRequests)).toHaveLength(1);
});

test('Single Entry leaves an instruction unsent when a fresh inventory reveals terminal-prepared references', async ({ page }) => {
  await transport(page, undefined, {}); await configure(page); await create(page);
  await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.push({ reference_id: 'a'.repeat(32),
    display_index: 1, display_name: 'terminal-only.txt', kind: 'file', image_detail: null, media_kind: null }));
  await entry(page); await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Runner pending references are present or unverified' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions', exact: true })).toHaveValue('/status');
});

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

test('browser-simulated drops preserve native paths and ignore other targets and DOM drops', async ({ page }) => {
  await transport(page); await configure(page); await create(page);
  const paths = ['C:\\Task 10\\한글 file.txt', 'C:\\Task 10\\folder', '\\\\server\\share\\folder'];
  await page.evaluate(paths => {
    const fixture = window.__nativeFixture;
    const payload = { paths, position: { x: 10, y: 20 } };
    fixture.nativeEvent('tauri://drag-enter', payload);
    fixture.nativeEvent('tauri://drag-drop', payload, 'other');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['fixture'], 'browser-file.txt'));
    document.querySelector('.workspace').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  }, paths);
  await expect(page.locator('.reference-path input')).toHaveCount(0);
  await page.evaluate(paths => window.__nativeFixture.drop(paths), paths);
  await expect.poll(() => page.locator('.reference-path input').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(paths);
  expect(await page.evaluate(() => [window.__nativeFixture.commands, window.__nativeFixture.writes])).toEqual([[], []]);
});

for (const state of ['not-ready', 'disabled', 'busy', 'disconnected']) {
  test(`browser-simulated drop rejects a ${state} Runner without changing candidates`, async ({ page }) => {
    await transport(page); await configure(page); await create(page);
    await page.evaluate(() => window.__nativeFixture.drop(['C:\\selected.txt']));
    await expect(page.locator('.reference-path input')).toHaveValue('C:\\selected.txt');
    await page.evaluate(state => {
      const control = window.__nativeFixture.sessions.get('pty-1').control;
      if (state === 'not-ready') control.state = 'connecting';
      if (state === 'disconnected') control.state = 'disconnected';
      if (state === 'disabled') Object.assign(control.observation.commands.find(command => command.text === '/files'),
        { enabled: false, disabled_reason: 'Reference interaction unavailable' });
      if (state === 'busy') control.results = [{ id: 1, command: '/status', state: 'pending-interaction' }];
    }, state);
    await expect(page.getByRole('button', { name: 'Attach file', exact: true })).toBeDisabled();
    await page.evaluate(() => window.__nativeFixture.drop(['C:\\rejected folder']));
    await expect(page.locator('.reference-path input')).toHaveValue('C:\\selected.txt');
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await page.evaluate(() => [window.__nativeFixture.commands, window.__nativeFixture.writes])).toEqual([[], []]);
  });
}

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
