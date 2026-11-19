export function registerRunnerStatus({ test, expect, transport, configure, create }) {
  test('IssueRun confirmed user action yields to process failure', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    await page.evaluate(() => {
      const s = window.__nativeFixture.sessions.get('pty-1');
      s.feature.config.current.run_mode = 'issue-run';
      s.control.observation.run_mode = 'issue-run';
      s.control.observation.execution.owned_execution_alive = true;
      s.control.observation.issue_run_user_action = { schema_version: 'issue-run-user-action-v1',
        status: 'required', issue_run_id: 'ir-failure', state_revision: 1,
        requirements: [{ kind: 'approval', request_key: '', request_version: '' }] };
    });
    const marker = page.locator('.runner-row').first().locator('.status-dot');
    await expect(marker).toHaveClass('status-dot attention');
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(marker).toHaveClass('status-dot failed');
  });
  test('IssueRun projection preserves Work safety and terminal uncertainty', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    const results = await page.evaluate(async () => {
      const { issueSidebarActivity, RunnerWork } = await import('/src/hub/runnerWork.ts');
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const observation = window.__nativeFixture.sessions.get('pty-1').control.observation;
      const service = new RunnerWork({}, () => {});
      const attempt = { work: terminalWork(1, 1, { run_mode: 'issue-run' }), uncertain: false, notSent: false };
      service.attempts.push(attempt);
      const check = () => ({ activity: issueSidebarActivity(attempt, observation), blocked: service.blocked });
      const results = [check()];
      attempt.work.state = 'incomplete'; results.push(check());
      attempt.work.state = 'suspended'; results.push(check());
      attempt.work.terminal = true; attempt.work.outcome = 'incomplete'; results.push(check());
      attempt.work.state = 'succeeded'; attempt.work.outcome = 'succeeded'; results.push(check());
      observation.execution.owned_execution_alive = true; results.push(check());
      attempt.uncertain = true; results.push(check());
      service.close(); return results;
    });
    expect(results.map(r => r.activity)).toEqual(['running', 'unknown', 'unknown', 'unknown', 'idle', 'running', 'running']);
    expect(results.map(r => r.blocked)).toEqual([true, true, true, false, false, false, true]);
  });
  test('IssueRun sidebar distinguishes autonomous work from unverified handoffs', async ({ page }) => {
    test.setTimeout(90000);
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    const marker = page.locator('.runner-row').first().locator('.status-dot');
    const baseline = await marker.boundingBox();
    await page.evaluate(() => {
      const s = window.__nativeFixture.sessions.get('pty-1');
      s.control.observation.run_mode = 'issue-run';
      s.feature.config.current.run_mode = 'issue-run';
    });
    await expect(marker).toHaveClass('status-dot idle');
    await expect(marker).toHaveCSS('color', 'rgb(34, 197, 94)');
    await expect(marker).toHaveAttribute('aria-label', 'Verified idle');
    await expect(marker.locator('svg')).toHaveCount(1);
    expect(await marker.boundingBox()).toEqual(baseline);
    let workId = 1;
    const publish = async changes => {
      changes = { id: workId, ...changes };
      await page.evaluate(async changes => {
        const { terminalWork } = await import('/tests/fixtures/work.ts');
        const s = window.__nativeFixture.sessions.get('pty-1');
        s.feature.config.current.run_mode = 'issue-run';
        Object.assign(s.control.observation, { run_mode: 'issue-run' });
        Object.assign(s.control.observation.execution, { lifecycle_state: 'INTERACTIVE_READY',
          owned_execution_alive: false, workflow_kind: '', ...changes.execution });
        Object.assign(s.control.observation.attention, { foreground_interaction_active: false,
          suspension_status: 'inactive', suspension_reason: '', awaiting_user_command_reason: '',
          restart_confirmation_required: false, termination_confirmation_active: false,
          account_setup_required: false, ...changes.attention });
        s.feature.observations.set(`terminal:${changes.id}`, terminalWork(changes.id, changes.event, {
          run_mode: 'issue-run', work_id: { kind: 'issue', id: 'ir-status' }, owner: 'issue_lifecycle',
          state: 'active', started_event_id: 1, owner_revision: 1, ...changes.work }));
      }, changes);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1')
        .feature.requests.filter(r => r.operation === 'work.list').at(-1)?.after_event_id ?? 0)).toBeGreaterThanOrEqual(changes.event);
      await page.evaluate(changes => { window.__nativeFixture.sessions.get('pty-1')
        .control.observation.attention.foreground_interaction_active = !changes.released; }, changes);
    };
    // Interpreter preparation, execution, then automatic Planner work retain one Work.
    for (const [event, state] of [[1, 'instruction_admitted'], [2, 'active'], [3, 'active']]) {
      await publish({ event, work: { state, started_event_id: event === 1 ? 0 : 1 } });
      await expect(marker).toHaveClass('status-dot running');
    }
    await expect(marker).toHaveCSS('color', 'rgb(59, 130, 246)');
    await expect(marker).toHaveAttribute('aria-label', 'Running');
    await expect(marker.locator('svg circle')).toHaveCount(1);
    expect(await marker.boundingBox()).toEqual(baseline);
    // Work v1 cannot distinguish a pending automatic action from a question/decision.
    for (const [event, work, attention] of [
      [4, { state: 'incomplete', outcome: 'incomplete' }, {}],
      [5, { state: 'suspended', owner: 'issue_stage_control' }, { suspension_status: 'suspended' }],
      [6, { state: 'active' }, { awaiting_user_command_reason: 'authentication_recovery' }],
    ]) {
      await publish({ event, work, attention });
      await expect(marker).toHaveClass('status-dot unknown');
    }
    await publish({ event: 7, attention: { restart_confirmation_required: true } });
    await expect(marker).toHaveClass('status-dot attention');
    await expect(marker).toHaveCSS('color', 'rgb(255, 214, 0)');
    await expect(marker).toHaveAttribute('aria-label', 'Suspended / needs attention');
    expect(await marker.boundingBox()).toEqual(baseline);
    await publish({ event: 8 });
    await expect(marker).toHaveClass('status-dot running');
    await expect(page.locator('.composer-area textarea[data-instruction]')).toBeDisabled();
    await expect(page.locator('.terminal-host textarea')).toHaveAttribute('readonly', '');
    let event = 8;
    const signal = async (status, requirements = [], extra = {}) => page.evaluate(({ status, requirements, extra }) => {
      const c = window.__nativeFixture.sessions.get('pty-1').control;
      c.observation.issue_run_user_action = { schema_version: 'issue-run-user-action-v1', status,
        issue_run_id: 'ir-status', state_revision: 1, requirements, ...extra };
    }, { status, requirements, extra });
    await publish({ event: ++event, execution: { owned_execution_alive: true }, work: { owner_revision: 1 } });
    for (const kind of ['clarification', 'approval', 'dialogue', 'human_request']) {
      await signal('required', [{ kind, request_key: kind === 'dialogue' || kind === 'human_request' ? 'opaque' : '',
        request_version: kind === 'dialogue' || kind === 'human_request' ? 'v1' : '' }]);
      await expect(marker).toHaveClass('status-dot attention');
      await expect(marker).toHaveAttribute('aria-label', 'IssueRun needs your response or approval');
      await expect(marker).toHaveAttribute('title', 'IssueRun needs your response or approval');
      await page.evaluate(async () => { const { i18n } = await import('/src/hub/i18n.ts'); await i18n.changeLanguage('ko'); });
      await expect(marker).toHaveAttribute('aria-label', 'IssueRun 응답 또는 승인 필요');
      await page.evaluate(async () => { const { i18n } = await import('/src/hub/i18n.ts'); await i18n.changeLanguage('en'); });
      await expect(marker).toHaveCSS('color', 'rgb(255, 214, 0)');
      await expect(marker.locator('svg path')).toHaveAttribute('d', 'M12 7v6m0 4h.01');
      expect(await marker.boundingBox()).toEqual(baseline);
      if (kind === 'clarification') {
        for (const [state, age, expected] of [['connecting', 0, 'starting'], ['ready', 999999, 'unknown'],
          ['ready', 0, 'attention']]) {
          await page.evaluate(({ state, age }) => Object.assign(window.__nativeFixture.sessions.get('pty-1').control,
            { state, age }), { state, age });
          await expect(marker).toHaveClass(`status-dot ${expected}`);
        }
      }
      await signal('not_required');
      await expect(marker).toHaveClass('status-dot running');
    }
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1')
      .control.observation.execution.owned_execution_alive = false; });
    for (const extra of [{ status: 'unknown' }, { state_revision: 2 }, { issue_run_id: 'other' },
      { schema_version: 'future' }, { requirements: [{}] }]) {
      await signal('required', [{ kind: 'approval', request_key: '', request_version: '' }], extra);
      await expect(marker).toHaveClass('status-dot unknown');
    }
    await signal('not_required');
    for (const state of ['suspended', 'incomplete']) {
      await publish({ event: ++event, work: { state, owner_revision: 1 } });
      await expect(marker).toHaveClass('status-dot unknown');
    }
    for (const outcome of ['succeeded', 'failed', 'interrupted', 'rejected']) {
      if (outcome === 'rejected') workId = 2;
      await publish({ event: ++event, released: true, work: { state: outcome, outcome, terminal: true, owner_revision: 1,
        started_event_id: outcome === 'rejected' ? 0 : 1,
        admission: outcome === 'rejected' ? 'rejected' : 'admitted' } });
      await expect(marker).toHaveClass('status-dot idle');
      await expect(marker).toHaveAttribute('aria-label', 'Verified idle');
      await expect(marker).toHaveCSS('color', 'rgb(34, 197, 94)');
      expect(await marker.boundingBox()).toEqual(baseline);
      await signal('not_required', [], { issue_run_id: '', state_revision: null });
      await expect(marker).toHaveClass('status-dot idle');
      await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1')
        .control.observation.execution.owned_execution_alive = true; });
      await expect(marker).toHaveClass('status-dot running');
      await expect(marker).toHaveAttribute('aria-label', 'Running');
    }
    for (const requirement of ['restart_confirmation_required', 'termination_confirmation_active', 'account_setup_required']) {
      await page.evaluate(requirement => {
        const attention = window.__nativeFixture.sessions.get('pty-1').control.observation.attention;
        Object.assign(attention, { restart_confirmation_required: false, termination_confirmation_active: false,
          account_setup_required: false, [requirement]: true });
      }, requirement);
      await expect(marker).toHaveClass('status-dot attention');
    }
    await publish({ event: ++event, work: { state: 'unknown' } });
    await expect(marker).toHaveClass('status-dot unknown');
    const safety = await page.evaluate(() => {
      const n = window.__nativeFixture, s = n.sessions.get('pty-1');
      return { writes: n.writes, submissions: s.feature.requests.filter(r => r.operation === 'work.submit') };
    });
    expect(safety).toEqual({ writes: [], submissions: [] });
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.age = 999999; });
    await expect(marker).toHaveClass('status-dot unknown');
    await page.evaluate(() => {
      const c = window.__nativeFixture.sessions.get('pty-1').control;
      c.state = 'ready'; c.age = 0; delete c.observation;
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(window.__nativeFixture.observed.get('pty-1') ?? '{}')
      .observation)).toBeUndefined();
    await expect(marker).toHaveClass('status-dot unknown');
    const draft = page.locator('.composer-area textarea[data-instruction]');
    await draft.fill('Retain this draft while observation is unavailable');
    await draft.press('Enter');
    await expect(draft).toBeDisabled();
    await expect(draft).toBeEnabled();
    await expect(draft).toHaveValue('Retain this draft while observation is unavailable');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1')
      .feature.requests.filter(r => r.operation === 'work.submit'))).toEqual([]);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.state = 'disconnected'; });
    await expect(marker).toHaveClass('status-dot unknown');
  });
  test('runner status releases completed TaskRun after historical unknown without losing unread', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    const marker = page.locator('.runner-row').first().locator('.status-dot');
    const publish = changes => page.evaluate(async changes => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const f = window.__nativeFixture.sessions.get('pty-1').feature;
      f.observations.set(`terminal:${changes.id}`, terminalWork(changes.id, changes.event, {
        run_mode: 'task-run', work_id: { kind: 'task', id: `task-${changes.id}` }, owner: 'task',
        started_event_id: changes.id, ...changes }));
    }, changes);
    await publish({ id: 1, event: 1, state: 'unknown', terminal: true, outcome: 'unknown' });
    await expect(marker).toHaveClass('status-dot unknown');
    await publish({ id: 2, event: 2 });
    await expect(marker).toHaveClass('status-dot running');
    await publish({ id: 2, event: 3, state: 'succeeded', terminal: true, outcome: 'succeeded' });
    await expect(marker).toHaveClass('status-dot idle');
    await expect(marker).toHaveCSS('color', 'rgb(34, 197, 94)');
    await expect(marker).toHaveAttribute('aria-label', 'Verified idle');
    await expect(page.locator('.runner-row').first().locator('.unread-completion')).toBeVisible();
    for (const state of ['running', 'attention', 'unknown', 'idle']) {
      await page.evaluate(state => {
        const c = window.__nativeFixture.sessions.get('pty-1').control;
        c.state = state === 'disconnected' ? 'disconnected' : 'ready';
        c.age = state === 'unknown' ? 999999 : 0;
        c.observation.execution.owned_execution_alive = state === 'running';
        c.observation.attention.suspension_status = state === 'attention' ? 'suspended' : 'inactive';
      }, state);
      await expect(marker).toHaveClass(`status-dot ${state === 'disconnected' ? 'unknown' : state}`);
    }
    await publish({ id: 3, event: 4 }); await expect(marker).toHaveClass('status-dot running');
    await publish({ id: 3, event: 5, state: 'succeeded', terminal: true, outcome: 'succeeded' });
    await expect(marker).toHaveClass('status-dot idle');
    await publish({ id: 4, event: 6, state: 'unknown', terminal: true, outcome: 'unknown' });
    await expect(marker).toHaveClass('status-dot unknown');
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.execution.owned_execution_alive = true; });
    await expect(marker).toHaveClass('status-dot running');
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.observation.attention.restart_confirmation_required = true; });
    await expect(marker).toHaveClass('status-dot attention');
    await expect(page.locator('.runner-row').first().locator('.unread-completion')).toBeVisible();
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(page.locator('.runner-row').first().locator('.unread-completion')).toHaveCount(0);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').control.state = 'disconnected'; });
    await expect(marker).toHaveClass('status-dot unknown');
  });
  for (const theme of ['light', 'black']) test(`runner circular status fixed coordinates ${theme}`, async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page); await create(page);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('button', { name: theme === 'light' ? 'Light' : 'Black', exact: true }).click();
    await page.keyboard.press('Escape');
    const rows = page.locator('.runner-row');
    const coordinates = () => rows.evaluateAll(rows => rows.map(row => {
      const content = row.querySelector('.rename-row') ?? row.querySelector('.nav-row');
      const marker = content.querySelector('.status-dot').getBoundingClientRect();
      const name = content.querySelector('.runner-name, input').getBoundingClientRect();
      const input = content.querySelector('input');
      const textOffset = input ? input.clientLeft + parseFloat(getComputedStyle(input).paddingLeft) : 0;
      return { center: marker.x + marker.width / 2, name: name.x + textOffset, width: marker.width, height: marker.height };
    }));
    const baseline = await coordinates();
    expect(baseline[0]).toEqual(baseline[1]);
    for (let cycle = 0; cycle < 2; cycle++) for (const state of ['starting', 'idle', 'running', 'attention', 'unknown']) {
      await page.evaluate(state => {
        const c = window.__nativeFixture.sessions.get('pty-1').control;
        c.state = state === 'starting' ? 'connecting' : 'ready';
        c.age = state === 'unknown' ? 999999 : 0;
        c.observation.execution.owned_execution_alive = state === 'running';
        c.observation.attention.foreground_interaction_active = state === 'attention';
      }, state);
      const marker = rows.first().locator('.status-dot');
      await expect(marker).toHaveClass(`status-dot ${state}`);
      expect(await coordinates()).toEqual(baseline);
      await expect(marker).toHaveAttribute('aria-label', /.+/);
      await expect(marker).toHaveAttribute('title', await marker.getAttribute('aria-label'));
      const svg = marker.locator('svg');
      await expect(svg).toHaveAttribute('stroke-width', '2');
      await expect(svg.locator('circle')).toHaveCount(state === 'starting' ? 0 : 1);
      const colors = { idle: 'rgb(34, 197, 94)', running: 'rgb(59, 130, 246)', attention: 'rgb(255, 214, 0)', unknown: 'rgb(156, 163, 175)', starting: 'rgb(59, 130, 246)' };
      await expect(marker).toHaveCSS('color', colors[state]);
      if (state === 'starting') {
        await expect(svg).toHaveCSS('animation-name', 'runner-starting');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(svg).toHaveCSS('animation-name', 'none');
        await expect(svg.locator('path')).toHaveAttribute('d', 'M12 3a9 9 0 1 1-9 9');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      if (cycle === 0) await info.attach(`${theme}-${state}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    await page.evaluate(() => window.__nativeFixture.exit('pty-1', 1));
    await expect(rows.first().locator('.status-dot.failed')).toHaveCSS('color', 'rgb(239, 68, 68)');
    expect(await coordinates()).toEqual(baseline);
    await rows.nth(1).hover(); await rows.nth(1).locator('.nav-row').focus();
    expect(await coordinates()).toEqual(baseline);
    await rows.nth(1).locator('.nav-row').press('F2');
    expect(await coordinates()).toEqual(baseline);
    await page.locator('.rename-row input').fill('Runner 2 with an exceptionally long name for truncation');
    await page.locator('.rename-row input').press('Enter');
    expect(await coordinates()).toEqual(baseline);
    await expect(rows.nth(1).locator('.runner-name')).toHaveCSS('text-overflow', 'ellipsis');
    for (let n = 0; n < 6; n++) await create(page);
    const scrollBaseline = await coordinates();
    await page.setViewportSize({ width: 950, height: 400 });
    expect(await coordinates()).toEqual(scrollBaseline);
    const list = page.locator('.runner-domains');
    expect(await list.evaluate(list => list.scrollHeight > list.clientHeight)).toBe(true);
    await list.evaluate(list => { list.scrollTop = list.scrollHeight; });
    expect(await list.evaluate(list => list.scrollTop)).toBeGreaterThan(0);
    expect(await coordinates()).toEqual(scrollBaseline);
    await info.attach(`${theme}-error-long-name`, { body: await page.screenshot(), contentType: 'image/png' });
  });
  for (const code of [0, null]) test(`runner circular status normal or unobserved exit ${code} stays unknown`, async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await configure(page); await create(page);
    await page.evaluate(code => window.__nativeFixture.exit('pty-1', code), code);
    await expect(page.locator('.runner-row .status-dot.unknown')).toBeVisible();
  });
}
