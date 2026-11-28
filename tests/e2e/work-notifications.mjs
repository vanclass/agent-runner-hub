import { openAppEntry, appItem } from './application-menu.mjs';

export function registerWorkNotifications({ test, expect, transport, configure, create }) {
  test('work notifications follow live authoritative events across inactive tabs and reconnects', async ({ page }) => {
    const historical = { observation_id: 'terminal:1', origin: 'terminal', submission_request_id: null,
      run_mode: 'task-run', state: 'succeeded', admission: 'admitted', work_id: { kind: 'task', id: 'old' },
      execution_id: 'old', event_id: 2, started_event_id: 1, terminal: true, outcome: 'succeeded', code: '',
      owner: 'task_completion', owner_revision: 0 };
    await transport(page, undefined, { work: true, auto: true, workHistory: [historical] });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__;
      const invoke = native.invoke;
      window.soundReads = [];
      window.soundStarts = 0;
      native.invoke = async (command, args) => {
        if (command === 'list_notification_sounds') return ['missing.wav', 'work-completed.wav', 'work-interrupted.wav'];
        if (command !== 'read_notification_sound') return invoke(command, args);
        window.soundReads.push(args.name);
        if (args.name === 'missing.wav') throw new Error('Sound unavailable');
        if (window.holdEventSound && args.name === 'work-interrupted.wav') {
          await new Promise(resolve => { window.releaseEventSound = resolve; });
        }
        const response = await fetch('/src-tauri/src/notification_sounds/' + args.name);
        return response.arrayBuffer();
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        const mute = this.context.createGain();
        mute.gain.value = 0;
        this.disconnect();
        this.connect(mute).connect(this.context.destination);
        start.apply(this, args);
        window.soundStarts++;
      };
    });

    await configure(page);
    await create(page);
    await create(page);
    const ids = await page.evaluate(() => [...window.__nativeFixture.sessions.keys()]);
    const first = ids[0], second = ids[1];
    const reads = () => page.evaluate(() => window.soundReads);
    const started = () => page.evaluate(() => window.soundStarts);

    await expect.poll(() => page.evaluate(id => window.__nativeFixture.sessions.get(id).feature.requests
      .some(request => request.operation === 'work.list'), first)).toBe(true);
    expect(await reads()).toEqual([]);
    const work = (id, number, event, changes) => page.evaluate(async ({ id, number, event, changes }) => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const f = window.__nativeFixture;
      const inventory = f.sessions.get(id).feature.observations;
      const previous = inventory.get('terminal:' + number);
      const next = { ...(previous ?? terminalWork(number, event, { run_mode: 'task-run',
        work_id: { kind: 'task', id: 'task-' + number } })), event_id: event, ...changes };
      inventory.set(next.observation_id, next);
      f.notify(id, 'work.changed', { change: previous ? 'updated' : 'created', work: next });
    }, { id, number, event, changes });
    const observation = (id, mode, changes) => page.evaluate(async ({ id, mode, changes }) => {
      const f = window.__nativeFixture, session = f.sessions.get(id);
      session.feature.config.current.run_mode = mode;
      Object.assign(session.control.observation, changes);
      await f.publish(id);
    }, { id, mode, changes });
    const signal = (status, state_revision, key = 'A') => ({ issue_run_user_action: {
      schema_version: 'issue-run-user-action-v1', issue_run_id: 'issue-1', status, state_revision,
      requirements: status === 'required' ? [{ kind: 'human_request', request_key: key, request_version: '1' }] : [],
    } });

    await observation(first, 'issue-run', signal('required', 1));
    await expect.poll(reads).toEqual(['user-request.wav']);
    await observation(first, 'issue-run', signal('unknown', 2));
    await observation(first, 'issue-run', signal('required', 3));
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect.poll(started).toBe(1);
    expect(await reads()).toEqual(['user-request.wav']);
    await observation(first, 'issue-run', signal('not_required', 4));
    await observation(first, 'issue-run', signal('required', 5));
    await observation(first, 'issue-run', signal('required', 6, 'B'));
    await expect.poll(started).toBe(3);

    await work(second, 2, 3, {});
    const attention = await page.evaluate(id => window.__nativeFixture.sessions.get(id).control.observation.attention, second);
    const waiting = { lifecycle_state: 'AWAITING_USER_COMMAND', owned_execution_alive: false, workflow_kind: 'task' };
    await observation(second, 'task-run', { execution: waiting,
      attention: { ...attention, foreground_interaction_active: true, awaiting_user_command_reason: 'unknown' } });
    expect(await reads()).toEqual(Array(3).fill('user-request.wav'));
    await observation(second, 'task-run', { execution: waiting,
      attention: { ...attention, awaiting_user_command_reason: 'authentication_recovery' } });
    await expect.poll(started).toBe(4);
    await observation(second, 'task-run', { attention });
    await work(second, 2, 4, { state: 'succeeded', outcome: 'succeeded' });
    await work(second, 2, 5, { state: 'suspended', outcome: 'incomplete' });
    await work(second, 2, 6, { state: 'incomplete', outcome: 'incomplete', terminal: true });
    await work(second, 3, 7, { state: 'failed', outcome: 'failed', started_event_id: 0, terminal: true });
    await work(second, 4, 8, { state: 'unknown', outcome: 'unknown', terminal: true });
    expect(await reads()).toEqual(Array(4).fill('user-request.wav'));

    await work(second, 5, 9, {});
    await page.evaluate(async id => {
      const f = window.__nativeFixture, session = f.sessions.get(id);
      Object.assign(session, { subscription: null, incomplete: true });
      await f.publish(id);
      const previous = session.feature.observations.get('terminal:5');
      session.feature.observations.set(previous.observation_id,
        { ...previous, event_id: 10, state: 'succeeded', outcome: 'succeeded', terminal: true });
      Object.assign(session, { subscription: 2, incomplete: false });
      await f.publish(id);
    }, second);
    await expect.poll(started).toBe(5);
    await work(second, 5, 10, {});
    await work(second, 6, 11, { state: 'failed', outcome: 'failed', terminal: true });
    await expect.poll(started).toBe(6);

    const save = async (category, sound) => {
      if (!await appItem(page, category).isVisible()) await openAppEntry(page, 'settings', 'notification-sounds');
      await appItem(page, category).click();
      const dialog = page.locator('.notification-sound-selector[open]');
      await dialog.getByRole('option', { name: sound, exact: true }).click();
      await dialog.getByRole('button', { name: 'Select', exact: true }).click();
    };
    await save('workCompleted', 'missing.wav');
    await work(second, 7, 12, { state: 'succeeded', outcome: 'succeeded', terminal: true });
    await work(second, 7, 12, {});
    await expect.poll(reads).toEqual([...Array(4).fill('user-request.wav'), 'work-completed.wav',
      'work-interrupted.wav', 'missing.wav', 'missing.wav']);
    expect(await started()).toBe(6);
    await save('workCompleted', 'Silent');
    await work(second, 8, 13, { state: 'succeeded', outcome: 'succeeded', terminal: true });

    await appItem(page, 'workInterrupted').click();
    const preview = page.locator('.notification-sound-selector[open]');
    await preview.getByRole('option', { name: 'work-completed.wav', exact: true }).click();
    await expect.poll(started).toBe(7);
    await page.evaluate(() => { window.holdEventSound = true; });
    await work(second, 9, 14, { state: 'interrupted', outcome: 'interrupted', terminal: true });
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => { window.holdEventSound = false; window.releaseEventSound(); });
    await expect.poll(started).toBe(8);

    await work(first, 10, 15, {});
    await page.evaluate(id => window.__nativeFixture.exit(id, 0), first);
    await work(second, 11, 16, {});
    await page.evaluate(id => window.__nativeFixture.exit(id, 1), second);
    await expect.poll(started).toBe(9);
    expect(await reads()).toEqual([...Array(4).fill('user-request.wav'), 'work-completed.wav',
      'work-interrupted.wav', 'missing.wav', 'missing.wav', 'work-completed.wav', 'work-interrupted.wav',
      'work-interrupted.wav']);
  });
}
