import { drop } from './composer-attachments.mjs';

export function registerRunnerDiscovery({ test, expect, transport, configure, create, records, generatedFixture }) {
  test('Runner event synchronization shares initial reads and reconciles an interrupted subscription', async ({ page }) => {
    const { generatedPng, generatedImages: [image] } = generatedFixture();
    await transport(page, undefined, { work: true, recoveryContexts: [], generatedImages: [], generatedPng });
    await page.goto('/');
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const created = new RunnerSessions().create('/fixture/install');
      window.__eventSession = created.session;
      await created.launched;
      const control = created.session.control;
      control.images.mount();
      window.__providerEvents = [];
      control.providerEvents.subscribe(event => window.__providerEvents.push(event?.notification.method ?? 'coverage-lost'));
    });
    const sample = () => page.evaluate(() => {
      const control = window.__eventSession.control, fixture = window.__nativeFixture;
      const session = fixture.sessions.get(control.sessionId);
      return { work: session.feature.requests.length, images: session.imageLists ?? 0,
        recovery: session.recoveries?.length ?? 0, observe: fixture.observationReads.length,
        snapshots: fixture.snapshotReads.length, staged: control.brief.stagedCount,
        preview: control.images.preview?.image.imageId,
        recoveryTask: control.recovery.connectedReference?.task_number,
        model: control.snapshot.observation?.selection.model,
        activity: control.work.activity, options: session.feature.config.requests.length };
    });
    await expect.poll(sample).toMatchObject({ work: 1, images: 1, recovery: 1, observe: 0, snapshots: 0 });
    await page.clock.install();
    const idle = await sample();
    await page.clock.runFor(31000);
    expect(await sample()).toEqual(idle);
    const imageId = 'a'.repeat(32);
    await page.evaluate(async image => {
      const fixture = window.__nativeFixture, id = window.__eventSession.control.sessionId;
      const native = fixture.sessions.get(id);
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const work = terminalWork(1, 1);
      native.feature.observations.set(work.observation_id, work);
      native.feature.config.current.model.id = 'm1';
      native.images.push(image);
      native.connectedRecovery = { runMode: 'task-run', disposition: 'suspended',
        reference: { version: 1, family: 'task-run', repository_namespace: 'project-exact',
          task_number: '17', task_workload_id: 'event-work' } };
      await fixture.publish(id);
      fixture.notify(id, 'work.changed', { change: 'created', work });
      fixture.notify(id, 'brief.changed', { action: 'staged', count: 1, revision: 2 });
      fixture.notify(id, 'brief.changed', { action: 'cleared', count: 0, revision: 1 });
      fixture.notify(id, 'provider.codex.notification', { execution_id: 'exec', instance_id: 'server',
        launch_generation: 1, thread_id: 'thread', turn_id: 'turn', provider_sequence: 10,
        notification: { method: 'turn/completed', params: {} } });
      fixture.notify(id, 'generated_images.changed');
      fixture.notify(id, 'recovery.changed');
    }, { ...image, imageId });
    await expect.poll(sample).toMatchObject({ work: 1, images: 2, recovery: 2, activity: 'running',
      staged: 1, preview: imageId, recoveryTask: '17', model: 'm1' });
    expect(await page.evaluate(() => window.__providerEvents)).toEqual(['turn/completed']);
    await page.evaluate(async () => {
      const fixture = window.__nativeFixture, id = window.__eventSession.control.sessionId, native = fixture.sessions.get(id);
      Object.assign(native, { subscription: null, incomplete: true });
      await fixture.publish(id);
      const work = native.feature.observations.get('terminal:1');
      native.feature.observations.set('terminal:1', { ...work, event_id: 2, terminal: true, state: 'succeeded', outcome: 'succeeded' });
    });
    await expect.poll(sample).toMatchObject({ work: 1, activity: 'unknown' });
    await page.evaluate(async () => {
      const fixture = window.__nativeFixture, id = window.__eventSession.control.sessionId;
      Object.assign(fixture.sessions.get(id), { subscription: 2, incomplete: false });
      await fixture.publish(id);
    });
    await expect.poll(sample).toMatchObject({ work: 2, images: 3, recovery: 3, activity: 'completed', snapshots: 0 });
  });
  const row = (page, name) => page.locator('.runner-row').filter({ has: page.getByText(name, { exact: true }) });
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  for (const operation of ['work.observe', 'work.status']) {
    const singleEntry = operation === 'work.status';
    test(`Work start reconciles after a coverage gap with a retained attachment via ${operation}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true, workMode: 'dispatch',
        workOperations: ['work.list', 'work.submit', operation] });
      await configure(page);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })
        .getByRole('option', { name: 'm0', exact: true })).toBeAttached();
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
      if (!singleEntry) await create(page);
      const draft = page.getByRole('textbox', { name: `${singleEntry ? 'Single Entry' : 'Runner'} instructions`, exact: true });
      await draft.evaluate(element => {
        let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
        for (; fiber; fiber = fiber.return) {
          const props = fiber.memoizedProps;
          if (props?.session || props?.entry) {
            window.__gapEntry = props.entry;
            window.__gapSession = () => props.session ?? props.entry.active?.session;
            break;
          }
        }
      });
      await drop(page, ['/fixture/image.png']);
      await draft.fill('retain original submission');
      await draft.press('Enter');
      await expect.poll(() => page.evaluate(() => {
        const session = window.__gapSession();
        if (!session?.control.work.current?.work) return;
        window.__gapControl = session.control;
        return { locked: session.control.attachmentLocked, start: session.control.work.current.work.started_event_id };
      })).toEqual({ locked: true, start: 0 });

      await page.evaluate(async singleEntry => {
        const fixture = window.__nativeFixture, id = window.__gapControl.sessionId;
        const native = fixture.sessions.get(id);
        Object.assign(native, { subscription: null, incomplete: true });
        native.control.state = 'connecting';
        await fixture.publish(id);
        const work = native.feature.work;
        const started = { ...work, state: 'active', admission: 'admitted', work_id: { kind: 'task', id: 'missed-start' },
          event_id: work.event_id + 1, started_event_id: work.event_id + 1 };
        native.feature.work = started;
        native.feature.observations.set(started.observation_id, started);
        fixture.notify(id, 'work.changed', { work: started, change: 'updated' });
        if (singleEntry) native.feature.fault = 'crossed';
        else {
          const send = native.feature.submit.bind(native.feature);
          const hold = new Promise(resolve => { window.__finishGapRead = resolve; });
          native.feature.submit = async request => {
            if (request.operation === 'work.observe') {
              window.__gapRead = { request, locked: window.__gapControl.attachmentLocked };
              await hold;
            }
            return send(request);
          };
        }
        native.feature.requests.splice(0, native.feature.requests.findIndex(r => r.operation === 'work.submit'));
        Object.assign(native, { subscription: 2, incomplete: false });
        native.control.state = 'ready';
        await fixture.publish(id);
      }, singleEntry);
      const reads = () => page.evaluate(() => {
        const { feature } = window.__nativeFixture.sessions.get(window.__gapControl.sessionId);
        return feature.requests.filter(r => ['work.status', 'work.observe'].includes(r.operation));
      });
      const original = await page.evaluate(() => window.__gapControl.work.current.submissionId);
      const expectedRead = singleEntry ? { operation, api_version: 1, submission_request_id: original }
        : { operation, api_version: 1, observation_id: `api:${original}` };
      if (singleEntry) {
        await home(page);
        await expect.poll(reads).toEqual([expectedRead]);
        await expect.poll(() => page.evaluate(() => window.__gapEntry.phase)).toBe('unknown');
        await expect(draft).toHaveValue('retain original submission');
        await expect(draft).toBeDisabled();
        await page.evaluate(async () => {
          const control = window.__gapControl, fixture = window.__nativeFixture;
          if (!control.attachmentLocked || control.work.hasConfirmedStart(control.work.current))
            throw Error('Unresolved receipt settled the original submission');
          await window.__gapEntry.submit('/fixture/install');
          const native = fixture.sessions.get(control.sessionId);
          native.feature.fault = undefined;
          native.subscription = 3;
          await fixture.publish(control.sessionId);
        });
      } else {
        await expect.poll(() => page.evaluate(() => window.__gapRead)).toEqual({ request: expectedRead, locked: true });
        await expect(draft).toHaveValue('retain original submission');
        await page.evaluate(async () => {
          const { work } = window.__gapControl;
          const shared = work.refreshStatus();
          window.__finishGapRead();
          await shared;
        });
      }
      await expect(draft).toHaveValue('');
      await expect(page.locator('.attachment-chip')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.__gapControl.attachmentLocked)).toBe(false);
      expect(await reads()).toEqual(singleEntry ? [expectedRead, expectedRead] : [expectedRead]);
      expect(await page.evaluate(() => {
        const { feature } = window.__nativeFixture.sessions.get(window.__gapControl.sessionId);
        return { submissions: feature.requests.filter(r => r.operation === 'work.submit').length,
          first: feature.requests.slice(0, 2).map(r => r.operation) };
      })).toEqual({ submissions: 1, first: ['work.submit', operation] });
    });
  }
  async function publish(page, id, changes = {}) {
    await page.evaluate(async ({ id, changes }) => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
      const event = Math.max(0, ...[...fixture.observations.values()].map(w => w.event_id)) + 1;
      const previous = fixture.observations.get(`terminal:${id}`);
      const work = terminalWork(id, event, { ...previous, ...changes, event_id: event });
      fixture.observations.set(work.observation_id, work);
      window.__nativeFixture.notify('pty-1', 'work.changed', { work, change: previous ? 'updated' : 'created' });
    }, { id, changes });
  }
  for (const route of ['composer', 'typing']) {
    test(`runner discovery ${route} respects GUI input ownership and discovers sequential inactive completion`, async ({ page }, info) => {
      await transport(page, undefined, { auto: true, work: true });
      await configure(page);
      await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
      await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
      await create(page);
      const own = row(page, 'Runner 1');
      for (let n = 1; n <= 2; n++) {
        const instruction = `short instruction ${n}`;
        if (route === 'composer') {
          await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.mode = 'started'; });
          await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill(instruction);
          await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).press('Enter');
          await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('', { timeout: 30000 });
        } else {
          await page.locator('.xterm-helper-textarea').focus();
          await page.keyboard.type(instruction); await page.keyboard.press('Enter');
        }
        // Synthetic authenticated Runner evidence; PTY bytes themselves establish no work.
        await home(page);
        if (n === 1) {
          await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\r\nTask completed (untrusted terminal text)\r\n'));
          await page.waitForTimeout(1700);
          await expect(own.locator('.status-dot.completed')).toHaveCount(0);
        }
        if (route === 'composer') await page.evaluate(() => {
          const f = window.__nativeFixture.sessions.get('pty-1').feature;
          f.mode = 'dispatch';
          Object.assign(f.work, { state: 'succeeded', terminal: true, outcome: 'succeeded', event_id: f.work.event_id + 1 });
          f.observations.set(f.work.observation_id, structuredClone(f.work));
          window.__nativeFixture.notify('pty-1', 'work.changed', { work: f.work, change: 'updated' });
        });
        else await publish(page, n, { state: 'succeeded', terminal: true, outcome: 'succeeded' });
        await expect(own.locator('.status-dot.idle')).toBeVisible();
        await expect(own.locator('.unread-completion')).toBeVisible();
        if (n === 1) await create(page);
        else await row(page, 'Runner 2').locator('.nav-row').click();
        await expect(own.locator('.unread-completion')).toBeVisible();
        await info.attach(`${route}-background-${n}`, { body: await page.screenshot(), contentType: 'image/png' });
        await own.locator('.nav-row').click();
        await expect(own.locator('.unread-completion')).toHaveCount(0);
      }
      const evidence = await page.evaluate(() => {
        const native = window.__nativeFixture, fixture = native.sessions.get('pty-1').feature;
        return { requests: fixture.requests, writes: native.writes,
          saved: localStorage.getItem('agent-runner-hub.workspace.v1') };
      });
      expect(evidence.requests.filter(r => r.operation === 'work.submit')).toHaveLength(route === 'composer' ? 2 : 0);
      expect(evidence.requests.filter(r => ['work.status', 'work.observe'].includes(r.operation))).toHaveLength(0);
      expect(evidence.requests.some(r => r.operation === 'work.list' && r.after_event_id === 0)).toBe(true);
      const input = records(evidence.writes, 'pty-1').filter(r => r.down);
      expect(input).toEqual([]);
      expect(evidence.saved).not.toMatch(/observation_id|submission_request|unread|short instruction/);
    });
  }
  test('runner discovery API route keeps one execution and one unread notification', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    const instruction = page.getByRole('textbox', { name: 'Single Entry instructions', exact: true });
    await instruction.fill('single API work');
    await instruction.evaluate(editor => {
      editor.addEventListener('keydown', () => {
        window.__assignmentStartIndex = window.__nativeFixture.sessions.get('pty-1').feature.requests.length;
      }, { once: true });
    });
    await instruction.press('Enter');
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ started_event_id: expect.any(Number), work_id: expect.any(Object) })]));
    await home(page);
    await page.evaluate(() => {
      const fixture = window.__nativeFixture.sessions.get('pty-1').feature;
      fixture.mode = 'dispatch';
      Object.assign(fixture.work, { state: 'succeeded', terminal: true, outcome: 'succeeded', event_id: fixture.work.event_id + 1 });
      fixture.observations.set(fixture.work.observation_id, structuredClone(fixture.work));
      window.__nativeFixture.notify('pty-1', 'work.changed', { work: fixture.work, change: 'updated' });
    });
    const own = row(page, 'Runner 1');
    await expect(own.locator('.status-dot.idle')).toBeVisible();
    await expect(own.locator('.unread-completion')).toBeVisible();
    await own.locator('.nav-row').click(); await home(page);
    await page.waitForTimeout(2200);
    await expect(own.locator('.unread-completion')).toHaveCount(0);
    const requests = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests);
    expect(requests.filter(r => r.operation === 'work.submit')).toHaveLength(1);
    const start = await page.evaluate(() => window.__assignmentStartIndex);
    expect(requests.slice(start, requests.findIndex(r => r.operation === 'work.submit'))).toEqual([]);
    expect(requests.some(r => r.operation === 'work.list')).toBe(true);
  });
  test('runner discovery pending reads leave configuration, attachment staging and images usable', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, generatedImages: [] });
    await configure(page); await create(page);
    await page.evaluate(async () => {
      const native = window.__nativeFixture.sessions.get('pty-1');
      const fixture = native.feature, send = fixture.submit.bind(fixture);
      const gate = new Promise(resolve => { window.__releaseRead = resolve; });
      fixture.submit = async request => {
        if (request.operation === 'work.list') { window.__readHeld = true; await gate; }
        return send(request);
      };
      native.subscription = 2;
      await window.__nativeFixture.publish('pty-1');
    });
    await expect.poll(() => page.evaluate(() => window.__readHeld)).toBe(true);
    await expect(page.locator('.task-panel .shortcut-bar')).toHaveCount(0);

    await page.getByRole('combobox', { name: 'Requested Account', exact: true }).focus();
    await expect(page.getByRole('combobox', { name: 'Requested Account', exact: true })).toBeEnabled();
    await drop(page, ['/fixture/image.png']);
    await expect(page.locator('.generated-images summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Refresh images', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh images', exact: true })).toBeEnabled();
    await expect(page.getByRole('list', { name: 'Pending attachments', exact: true }).locator('.attachment-open > span')).toHaveText('image.png');
    await page.getByRole('button', { name: 'Remove attachment /fixture/image.png', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.id === 'pty-1'))).toEqual([]);
    await page.evaluate(() => window.__releaseRead());
  });
  test('Runner foreground ownership blocks new Work after a pushed observation', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    await publish(page, 1, { state: 'suspended', outcome: 'interrupted' });
    await expect(row(page, 'Runner 1').locator('.status-dot.attention')).toBeVisible();
    await page.evaluate(async () => {
      const control = window.__nativeFixture.sessions.get('pty-1').control;
      control.observation.attention.foreground_interaction_active = true;
      await window.__nativeFixture.publish('pty-1');
    });
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
      .filter(r => r.operation === 'work.submit'))).toEqual([]);
  });
}
