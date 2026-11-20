export function registerRunnerNavigation({ test, expect, transport, configure, create }) {
  const modes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'];
  const domain = (page, mode) => page.locator(`[data-domain="${mode}"]`);
  const ids = locator => locator.locator('.runner-row').evaluateAll(rows => rows.map(r => r.dataset.runnerId));
  async function display(page, value) {
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Domain display', exact: true }).selectOption(value);
    await page.keyboard.press('Escape');
  }
  async function publish(page, pty, mode, started = true, outcome = 'succeeded') {
    await page.evaluate(async ({ pty, mode, started, outcome }) => {
      const { terminalWork } = await import('/tests/fixtures/work.ts');
      const f = window.__nativeFixture.sessions.get(pty).feature;
      const event = Math.max(0, ...[...f.observations.values()].map(w => w.event_id)) + 1;
      f.observations.set(`terminal:${event}`, terminalWork(event, event, { run_mode: mode,
        started_event_id: started ? event : 0, state: started || outcome === 'unknown' ? outcome : 'rejected',
        admission: started ? 'admitted' : outcome === 'unknown' ? 'unknown' : 'rejected',
        terminal: true, outcome: started || outcome === 'unknown' ? outcome : 'rejected' }));
    }, { pty, mode, started, outcome });
  }
  test('navigation confirmed unknown outcome creates domain and current affinity retained after reload', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
    const id = await page.locator('.runner-row').getAttribute('data-runner-id');
    await display(page, 'run-mode');
    await publish(page, 'pty-1', 'issue-run', false, 'unknown');
    await page.waitForTimeout(2100);
    await expect(page.locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation.executedModes)).toEqual([]);
    await publish(page, 'pty-1', 'task-run');
    await expect(domain(page, 'task-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await publish(page, 'pty-1', 'issue-run', true, 'unknown');
    await expect(domain(page, 'issue-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await expect(domain(page, 'task-run')).toHaveCount(0);
    await expect(domain(page, 'issue-run').locator('.status-dot.unknown')).toBeVisible();
    const presentation = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation);
    expect(presentation.executedModes).toEqual(['task-run', 'issue-run']);
    expect(presentation.affinities[id]).toBe('issue-run');
    await info.attach('unknown-outcome-domain', { body: await page.screenshot(), contentType: 'image/png' });
    await page.reload();
    await expect(domain(page, 'issue-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await expect(domain(page, 'task-run')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation)).toEqual(presentation);
    await info.attach('unknown-outcome-restored', { body: await page.screenshot(), contentType: 'image/png' });
    await domain(page, 'issue-run').locator('.remove-action').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Terminate and close tab' }).click();
    await expect(page.locator('.runner-domain, .add-runner')).toHaveCount(0);
    await expect(page.locator('.single-entry')).toBeVisible();
    await expect(page.locator('.runner-management')).toBeVisible();
    await display(page, 'unified');
    await expect(domain(page, 'runner').locator('.add-runner')).toBeEnabled();
  });
  test('navigation Runner mode edit immediately moves the same session before submission', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
    const id = await page.locator('.runner-row').getAttribute('data-runner-id');
    await create(page);
    const other = await page.locator('.runner-row.active').getAttribute('data-runner-id');
    const editor = page.locator('textarea[data-instruction]');
    const single = page.getByRole('button', { name: 'Single Entry', exact: true });
    const editDraft = async (tab, first, last) => {
      await tab.click();
      await expect(editor).toBeEditable();
      await editor.click();
      await page.keyboard.insertText(first);
      await page.keyboard.insertText(last);
      await expect(editor).toHaveValue(first + last);
    };
    const deliveryCounts = () => page.evaluate(() => {
      const fixture = window.__nativeFixture;
      return {
        work: [...fixture.sessions.values()].flatMap(session => session.feature.requests)
          .filter(request => request.operation === 'work.submit').length,
        commands: fixture.commands.length,
        writes: fixture.writes.length,
      };
    });
    const beforeEdits = await deliveryCounts();
    await editDraft(page.locator(`[data-runner-id="${other}"] .nav-row`), 'Peer Runner', ' draft');
    await editDraft(single, 'Single Entry', ' draft');
    await page.locator(`[data-runner-id="${id}"] .nav-row`).click();
    await publish(page, 'pty-1', 'issue-run'); await display(page, 'run-mode');
    await expect(domain(page, 'issue-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await expect.poll(() => ids(page)).toEqual([other, id]);
    const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
    await expect(domain(page, 'direct-run')).toHaveCount(0);
    const text = page.locator('.composer textarea');
    const moved = page.locator(`[data-runner-id="${id}"] .nav-row`);
    await editDraft(moved, 'move this', ' existing Runner');
    const before = await page.evaluate(() => ({ native: [...window.__nativeFixture.sessions.keys()], closed: window.__nativeFixture.closed }));
    await mode.selectOption(JSON.stringify('direct-run'));
    await expect(domain(page, 'direct-run').locator('.runner-row.active')).toHaveAttribute('data-runner-id', id);
    await expect(page.locator(`[data-runner-id="${id}"]`)).toHaveCount(1);
    await expect(domain(page, 'issue-run')).toHaveCount(0);
    await expect(mode).toHaveValue(JSON.stringify('direct-run'));
    await expect(text).toHaveValue('move this existing Runner');
    await expect.poll(() => ids(page)).toEqual([id, other]);
    await single.click();
    await page.keyboard.press('Control+1');
    await expect(moved).toHaveAttribute('aria-current', 'page');
    await expect(moved).toBeFocused();
    await expect(editor).toHaveValue('move this existing Runner');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('move this');
    await editor.press('Control+y');
    await expect(editor).toHaveValue('move this existing Runner');
    await single.click();
    await expect(editor).toHaveValue('Single Entry draft');
    await page.locator(`[data-runner-id="${other}"] .nav-row`).click();
    await expect(editor).toHaveValue('Peer Runner draft');
    expect(await deliveryCounts()).toEqual(beforeEdits);
    await moved.click();
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
    expect(await page.evaluate(() => ({ native: [...window.__nativeFixture.sessions.keys()], closed: window.__nativeFixture.closed }))).toEqual(before);
    await page.evaluate(() => {
      const f = window.__nativeFixture.sessions.get('pty-1').feature;
      const old = f.observations.get('terminal:1');
      f.observations.set('terminal:1', { ...old, event_id: old.event_id + 1, owner_revision: old.owner_revision + 1 });
    });
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
      .filter(r => r.operation === 'work.list').some(r => r.after_event_id >= 2))).toBe(true);
    await expect(domain(page, 'direct-run').locator('.runner-row.active')).toHaveAttribute('data-runner-id', id);
    await expect(domain(page, 'issue-run')).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
      .filter(r => r.operation === 'work.submit'))).toEqual([]);
    await page.locator(`[data-runner-id="${other}"] .nav-row`).click();
    await expect(mode).toHaveValue(JSON.stringify('task-run'));
    await page.locator(`[data-runner-id="${id}"] .nav-row`).click();
    await expect(text).toHaveValue('move this existing Runner');
    await info.attach('immediate-tab-mode-move', { body: await page.screenshot(), contentType: 'image/png' });
  });
  async function checkPureDirectPlus(page, expectedRoot) {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
    const root = page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true });
    const target = page.getByRole('combobox', { name: 'Requested Project / Target', exact: true });
    if (expectedRoot) {
      await mode.selectOption(JSON.stringify('direct-run'));
      await root.fill(expectedRoot);
    }
    await mode.selectOption(JSON.stringify('issue-run'));
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      const spareStartup = new Promise(resolve => { window.__releaseNavigationSpare = resolve; });
      native.invoke = async (command, args) => {
        // Park the replenished spare so this click exercises the new session's first inspection.
        if (command === 'pty_open') {
          const id = await invoke(command, args);
          if (id === 'pty-2') await spareStartup;
          return id;
        }
        if (command === 'runner_feature' && args.id === 'pty-3'
          && args.request.request.operation === 'session_config.inspect') {
          const config = window.__nativeFixture.sessions.get(args.id).feature.config;
          if (!config.requests.length) config.holdOperation = 'session_config.inspect';
        }
        return invoke(command, args);
      };
    });
    await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await expect(page.locator('.runner-row.active')).toBeVisible();
    await expect(mode).toHaveValue(JSON.stringify('issue-run'));
    await publish(page, 'pty-1', 'pure-direct-run');
    await display(page, 'run-mode');
    const pure = domain(page, 'pure-direct-run');
    const previous = await pure.locator('.runner-row.active').getAttribute('data-runner-id');
    await pure.locator('.add-runner').click();
    const selected = pure.locator('.runner-row.active');
    await expect(selected).toBeVisible();
    const id = await selected.getAttribute('data-runner-id');
    expect(id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(previous);
    const checkRequestedSettings = async () => {
      await expect(selected).toHaveAttribute('data-runner-id', id);
      await expect(page.locator(`[data-runner-id="${id}"]`)).toHaveCount(1);
      await expect(mode).toHaveValue(JSON.stringify('pure-direct-run'));
      await expect(root).toBeVisible();
      await expect(root).toHaveValue(expectedRoot);
      await expect(target).toHaveCount(0);
    };
    await test.step('Verify the new UUID and requested settings while inspection is pending', async () => {
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.sessions.get('pty-3')?.feature.config
        .features.results.find(result => result.operation === 'session_config.inspect')?.phase)).toBe('queued');
      await expect(mode).toBeDisabled();
      await checkRequestedSettings();
    });
    await page.evaluate(() => {
      const config = window.__nativeFixture.sessions.get('pty-3').feature.config;
      config.holdOperation = '';
      config.complete();
    });
    await test.step('Verify the same UUID and requested settings after options settle', async () => {
      await expect(mode).toBeEnabled();
      await expect(mode.locator('option:enabled').filter({ hasText: /^Pure Direct Run$/ })).toHaveCount(1);
      await checkRequestedSettings();
    });
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
      s.feature.config.requests.every(r => r.operation === 'session_config.inspect')
      && s.feature.requests.every(r => r.operation === 'work.list')))).toBe(true);
    await page.evaluate(() => window.__releaseNavigationSpare());
  }
  for (const [rootCase, expectedRoot] of [['unset root', ''], ['explicit root', 'C:/explicit-root']]) {
    test(`navigation Pure Direct plus initializes the selected tab from an Issue Run baseline: ${rootCase}`, async ({ page }) => {
      await checkPureDirectPlus(page, expectedRoot);
    });
  }
  for (const source of ['fresh', 'retired', 'spare']) {
    test(`navigation domain allocation keeps requested mode through options: ${source}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
      await page.evaluate(async source => {
        const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
        const { resolveRunnerInstallation } = await import('/src/hub/runnerInstallation.ts');
        const location = '/fixture/install';
        const owner = window.__domainOwner = new RunnerSessions(source === 'fresh' ? {} : { root: 'C:/explicit-root' });
        window.__domainInstallation = await resolveRunnerInstallation(location);
        if (source === 'spare') owner.setInstallation(window.__domainInstallation);
        if (source === 'retired') {
          const { session, launched } = owner.create(location); await launched;
          await session.control.fresh();
          window.__retiredRunner = session; owner.close(session.view.id);
        }
      }, source);
      if (source === 'retired') await expect.poll(() => page.evaluate(() => window.__retiredRunner.reusableIdle)).toBe(true);
      if (source === 'spare') await expect.poll(() => page.evaluate(() => window.__domainOwner.spareSnapshot.state)).toBe('ready');
      const initial = await page.evaluate(async source => {
        const owner = window.__domainOwner, installation = window.__domainInstallation;
        const initialCount = window.__nativeFixture.count();
        const { session, launched, promoted } = owner.allocate(installation.root, undefined, 'pure-direct-run');
        window.__domainSession = session;
        const selections = window.__domainSelections = owner.getSelections(session.view.id);
        if (source !== 'spare') selections.setDefault('runMode', 'issue-run');
        const initial = { mode: selections.defaults.runMode, root: selections.defaults.root, initialized: selections.initialized,
          reused: session === window.__retiredRunner, promoted: !!promoted };
        await launched;
        if (source === 'fresh') {
          const { current } = window.__nativeFixture.sessions.get(session.control.sessionId).feature.config;
          Object.assign(current, { run_mode: 'direct-run', root: 'C:/native-root' });
          await session.control.fresh();
        }
        initial.opened = window.__nativeFixture.count() > initialCount;
        if (source !== 'spare') owner.setInstallation(installation);
        return initial;
      }, source);
      const root = source === 'fresh' ? undefined : 'C:/explicit-root';
      expect(initial).toMatchObject({ mode: 'pure-direct-run', root, initialized: source === 'spare',
        reused: source === 'retired', promoted: source === 'spare' });
      if (source !== 'spare') expect(initial.opened).toBe(source === 'fresh');
      await expect.poll(() => page.evaluate(() => window.__domainSelections.initialized && !window.__domainSelections.loadingOptions)).toBe(true);
      const defaults = await page.evaluate(() => window.__domainSelections.defaults);
      expect(defaults).toMatchObject({ runMode: 'pure-direct-run', model: { model: 'm0' } });
      expect(defaults.root).toBe(root);
      expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].every(s =>
        s.feature.config.requests.every(r => r.operation === 'session_config.inspect')
        && s.feature.requests.every(r => r.operation === 'work.list')))).toBe(true);
      if (source === 'fresh') {
        expect(await page.evaluate(() => {
          const owner = window.__domainOwner, session = window.__domainSession, entry = window.__domainSelections;
          const id = session.view.id, token = Symbol();
          const placement = () => owner.navigation.snapshot.affinities[id];
          const locked = session.reserve(token);
          entry.setDefault('runMode', 'issue-run');
          const lockedMode = placement();
          session.release(token);
          return { locked, lockedMode };
        })).toEqual({ locked: true, lockedMode: 'pure-direct-run' });
        await expect.poll(() => page.evaluate(() => {
          const entry = window.__domainSelections;
          return !!entry.catalog && !entry.loadingOptions;
        })).toBe(true);
        expect(await page.evaluate(() => {
          const owner = window.__domainOwner, session = window.__domainSession, entry = window.__domainSelections;
          const id = session.view.id, placement = () => owner.navigation.snapshot.affinities[id];
          entry.setDefault('runMode', 'unsupported-mode');
          const unsupported = placement();
          entry.setDefault('runMode', 'issue-run');
          const accepted = placement();
          const closed = owner.close(id);
          entry.setDefault('runMode', 'direct-run');
          return { unsupported, accepted, closed, staleRequested: entry.defaults.runMode };
        })).toEqual({ unsupported: 'pure-direct-run',
          accepted: 'issue-run', closed: true, staleRequested: 'issue-run' });
      }
      await page.evaluate(() => window.__domainOwner.dispose());
    });
  }
  test('navigation unstarted tab survives display toggles and reload without false history or process counts', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page); await create(page);
    const id = await page.locator('.runner-row').getAttribute('data-runner-id');
    await page.locator('.composer textarea').fill('retained draft');
    for (const value of ['run-mode', 'unified', 'run-mode']) {
      await display(page, value);
      await expect(page.locator('.runner-row')).toHaveCount(1);
      await expect(page.locator('.runner-row.active')).toHaveAttribute('data-runner-id', id);
      await expect(page.locator('.composer textarea')).toHaveValue('retained draft');
      await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    }
    await page.reload();
    await expect(page.locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await expect(page.locator('.runner-section-label .sidebar-label')).toHaveCount(0);
    await page.locator('.runner-row .nav-row').click();
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation.executedModes)).toEqual([]);
  });
  async function hoverDrop(page, from, to, after) {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + 45, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 50, a.y + a.height / 2 + 8, { steps: 5 });
    const y = after ? b.y + b.height - 2 : b.y + 2;
    await page.mouse.move(b.x + 50, y, { steps: 12 });
    await page.mouse.move(b.x + 51, y);
  }
  async function mouseMove(page, from, to, after, info) {
    await hoverDrop(page, from, to, after);
    await expect(page.locator('.drop-before, .drop-end')).toHaveCount(1);
    const marker = page.locator('.drop-before, .drop-end');
    expect(await marker.evaluate(node => {
      const style = getComputedStyle(node, node.classList.contains('drop-before') ? '::before' : '::after');
      return { display: style.display, height: style.height, color: style.backgroundColor };
    })).toEqual({ display: 'block', height: '3px', color: 'rgb(40, 95, 165)' });
    await info.attach('navigation-insertion', { body: await page.screenshot(), contentType: 'image/png' });
    await page.mouse.up();
    await expect(marker).toHaveCount(0);
  }
  test('navigation production domains observe starts, persist, add and reorder without changing ownership', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await expect(domain(page, 'runner')).toBeVisible(); await expect(domain(page, 'runner').locator('.runner-row')).toHaveCount(0);
    await display(page, 'run-mode');
    await expect(page.locator('.runner-domain, .add-runner, .runner-section-label .sidebar-label')).toHaveCount(0);
    await expect(page.locator('.single-entry')).toBeVisible();
    await display(page, 'unified');
    await create(page);
    await display(page, 'run-mode');
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await expect(page.locator('.runner-section-label .sidebar-label')).toHaveCount(0);
    await publish(page, 'pty-1', 'issue-run', false);
    await page.waitForTimeout(2100);
    await expect(page.locator('.runner-row')).toHaveCount(1);
    await publish(page, 'pty-1', modes[0]);
    await expect(domain(page, modes[0])).toBeVisible();
    for (let i = 1; i < modes.length; i++) {
      await display(page, 'unified'); await create(page); await publish(page, `pty-${i + 1}`, modes[i]);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation.executedModes.length)).toBe(i + 1);
    }
    await display(page, 'run-mode');
    for (const mode of modes) await expect(domain(page, mode).locator('.runner-row')).toHaveCount(1);
    const beforeAdd = await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature?.requests ?? []).filter(r => r.operation === 'work.submit').length);
    await domain(page, 'task-run').locator('.add-runner').click();
    await expect(domain(page, 'task-run').locator('.runner-row')).toHaveCount(2);
    await domain(page, 'task-run').locator('.add-runner').click();
    await expect(domain(page, 'task-run').locator('.runner-row')).toHaveCount(3);
    const task = domain(page, 'task-run'), rows = task.locator('.runner-row');
    const original = await ids(task), selected = await page.locator('.runner-row.active').getAttribute('data-runner-id');
    await page.locator('.composer textarea').fill('navigation draft');
    const ownership = await page.evaluate(() => ({ tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs,
      native: [...window.__nativeFixture.sessions.keys()], closed: window.__nativeFixture.closed }));
    const preferences = () => page.evaluate(() => localStorage.getItem('agent-runner-hub.preferences.v1'));
    await expect(page.getByRole('combobox', { name: 'Requested Run Mode', exact: true })).toBeEnabled();
    const requestedBefore = await preferences();
    await mouseMove(page, rows.nth(2), rows.nth(0), false, info);
    await expect.poll(() => ids(task)).toEqual([original[2], original[0], original[1]]);
    await mouseMove(page, rows.nth(0), rows.nth(2), true, info);
    await expect.poll(() => ids(task)).toEqual(original);
    await mouseMove(page, rows.nth(0), rows.nth(1), true, info);
    await expect.poll(() => ids(task)).toEqual([original[1], original[0], original[2]]);
    expect(await preferences()).toBe(requestedBefore);
    await expect(page.locator('.runner-row.active')).toHaveAttribute('data-runner-id', selected);
    await expect(page.locator('.composer textarea')).toHaveValue('navigation draft');
    const after = await page.evaluate(() => ({ tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs,
      native: [...window.__nativeFixture.sessions.keys()], closed: window.__nativeFixture.closed }));
    expect(after).toEqual(ownership);
    for (const d of await page.locator('.runner-domain').all()) {
      const add = await d.locator('.add-runner').boundingBox(), last = await d.locator('.runner-row').last().boundingBox();
      expect(add.y).toBeGreaterThanOrEqual(last.y + last.height);
      expect(add.height).toBe(48);
      expect(add.width).toBeCloseTo((await d.boundingBox()).width, 0);
      await expect(d.locator('.add-runner')).toHaveCSS('background-color', 'rgb(214, 239, 223)');
    }
    const menu = await page.locator('.runner-management').boundingBox(), header = await page.locator('.runner-section-label').boundingBox();
    expect(menu.x + menu.width).toBeCloseTo(header.x + header.width, 0);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.keyboard.press('Control+3');
    await expect(task.locator('.runner-row').first().locator('.nav-row')).toHaveAttribute('aria-current', 'page');
    const stored = await page.evaluate(() => localStorage.getItem('agent-runner-hub.workspace.v1'));
    expect(stored).not.toMatch(/observation_id|submission_request|navigation draft|pty-|generation|unread/);
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature?.requests ?? []).filter(r => r.operation === 'work.submit').length)).toBe(beforeAdd);
    await page.reload();
    for (const mode of modes) await expect(domain(page, mode)).toBeVisible();
    await expect.poll(() => ids(task)).toEqual([original[1], original[0], original[2]]);
    await info.attach('navigation-restored', { body: await page.screenshot(), contentType: 'image/png' });
    for (const language of ['en', 'ko']) for (const theme of ['light', 'black']) {
      await page.locator('.app-settings-trigger').first().click();
      await page.locator('.language-picker select').selectOption(language);
      await page.locator('.theme-picker button').nth(theme === 'light' ? 0 : 1).click();
      await expect(page.locator('.domain-preference select').first()).toHaveValue('run-mode');
      await page.keyboard.press('Escape');
      await expect(page.locator('.runner-domain')).toHaveCount(4);
      await expect(page.locator('.hub')).toHaveAttribute('data-theme', theme);
      const add = page.locator('.add-runner').first();
      await expect(add).toHaveCSS('height', '48px');
      await expect(add).toHaveCSS('background-color', theme === 'light' ? 'rgb(214, 239, 223)' : 'rgb(25, 59, 41)');
      await add.hover();
      await expect(add).toHaveCSS('background-color', theme === 'light' ? 'rgb(189, 228, 205)' : 'rgb(36, 83, 57)');
      await page.mouse.move(700, 20);
      await info.attach(`navigation-${language}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    const startHover = async () => {
      const a = await rows.last().boundingBox(), b = await rows.first().boundingBox();
      await page.mouse.move(a.x + 45, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(a.x + 50, a.y + a.height / 2 + 8, { steps: 5 });
      await page.mouse.move(b.x + 50, b.y + 2, { steps: 12 });
      await expect(page.locator('.drop-before')).toHaveCount(1);
    };
    const savedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation.order);
    await startHover(); await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.locator('.drop-before, .drop-end')).toHaveCount(0);
    await startHover(); await publish(page, 'pty-6', 'issue-run');
    await expect(domain(page, 'issue-run').locator('.runner-row')).toHaveCount(2);
    await expect(page.locator('.drop-before, .drop-end')).toHaveCount(0); await page.mouse.up();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation.order)).toEqual(savedOrder);
  });

  test('navigation cross-domain pointer drops update only the dragged UUID and restore placement', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    const mode = page.getByRole('combobox', { name: 'Requested Run Mode', exact: true });
    const root = page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true });
    const target = page.getByRole('combobox', { name: 'Requested Project / Target', exact: true });
    const activeId = () => page.locator('.runner-row.active').getAttribute('data-runner-id');
    const row = id => page.locator(`[data-runner-id="${id}"]`);
    const select = id => row(id).locator('.nav-row').click();
    const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).runnerSelections);
    const presentation = () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation);
    const ownership = () => page.evaluate(() => ({
      tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs,
      native: [...window.__nativeFixture.sessions.keys()], closed: window.__nativeFixture.closed,
      work: [...window.__nativeFixture.sessions.get('pty-1').feature.observations],
      effects: [...window.__nativeFixture.sessions.values()].flatMap(session => [
        ...session.feature.requests.filter(r => r.operation === 'work.submit'),
        ...session.feature.config.requests.filter(r => r.operation !== 'session_config.inspect')
      ]),
    }));
    const marker = page.locator('.drop-before, .drop-end');

    await create(page);
    const moved = await activeId();
    await mode.selectOption(JSON.stringify('direct-run'));
    await root.fill('C:/drag-root');
    await publish(page, 'pty-1', 'direct-run');
    await expect.poll(async () => (await presentation()).executedModes).toContain('direct-run');
    await page.locator('.composer textarea').fill('cross-domain draft');
    await create(page);
    const taskPeer = await activeId();
    await expect(mode).toBeEnabled();
    await create(page);
    const purePeer = await activeId();
    await mode.selectOption(JSON.stringify('pure-direct-run'));
    await display(page, 'run-mode');
    await select(moved);
    await expect(mode).toBeEnabled();
    const previous = await settings(), owners = await ownership();

    await hoverDrop(page, row(moved), row(taskPeer), false);
    await expect(row(taskPeer)).toHaveClass(/drop-before/);
    const beforeCancel = await presentation();
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(marker).toHaveCount(0);
    expect(await presentation()).toEqual(beforeCancel);
    expect(await settings()).toEqual(previous);

    await mouseMove(page, row(moved), row(taskPeer), false, info);
    await expect.poll(() => ids(domain(page, 'task-run'))).toEqual([moved, taskPeer]);
    await expect(domain(page, 'direct-run')).toHaveCount(0);
    await expect(row(moved)).toHaveCount(1);
    expect(await activeId()).toBe(moved);
    await expect(mode).toHaveValue(JSON.stringify('task-run'));
    await expect(target).toBeVisible();
    await expect(root).toHaveCount(0);
    expect((await settings())[moved]).toEqual({ ...previous[moved], runMode: 'task-run' });

    await select(taskPeer);
    await hoverDrop(page, row(moved), row(purePeer), true);
    await expect(domain(page, 'pure-direct-run').locator('.drop-end')).toBeVisible();
    await page.mouse.up();
    await expect(marker).toHaveCount(0);
    await expect.poll(() => ids(domain(page, 'pure-direct-run'))).toEqual([purePeer, moved]);
    expect(await ids(domain(page, 'task-run'))).toEqual([taskPeer]);
    expect(await activeId()).toBe(taskPeer);
    await expect(mode).toHaveValue(JSON.stringify('task-run'));
    expect(await settings()).toEqual({ ...previous, [moved]: { ...previous[moved], runMode: 'pure-direct-run' } });
    await select(moved);
    await expect(mode).toHaveValue(JSON.stringify('pure-direct-run'));
    await expect(root).toHaveValue('C:/drag-root');
    await expect(target).toHaveCount(0);
    await expect(page.locator('.composer textarea')).toHaveValue('cross-domain draft');
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕 🌍');
    expect(await ownership()).toEqual(owners);

    await hoverDrop(page, row(moved), row(taskPeer), false);
    await expect(row(taskPeer)).toHaveClass(/drop-before/);
    const beforeStale = await presentation();
    await publish(page, 'pty-3', 'task-run');
    await expect.poll(() => ids(domain(page, 'task-run'))).toEqual([purePeer, taskPeer]);
    await expect(marker).toHaveCount(0);
    const changedMembership = await presentation();
    await page.mouse.up();
    expect(changedMembership.order).toEqual(beforeStale.order);
    expect(await presentation()).toEqual(changedMembership);
    expect((await settings())[moved]).toEqual({ ...previous[moved], runMode: 'pure-direct-run' });

    await page.reload();
    await expect.poll(() => ids(domain(page, 'pure-direct-run'))).toEqual([moved]);
    await expect.poll(() => ids(domain(page, 'task-run'))).toEqual([purePeer, taskPeer]);
    await expect(domain(page, 'direct-run')).toHaveCount(0);
    await select(moved);
    await expect(mode).toHaveValue(JSON.stringify('pure-direct-run'));
    await expect(root).toHaveValue('C:/drag-root');
    expect(await presentation()).toEqual(changedMembership);
  });

  test('navigation drop rejects locked and unsupported sessions before committing either owner', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true });
    await page.goto('/');
    await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const { resolveRunnerInstallation } = await import('/src/hub/runnerInstallation.ts');
      const location = '/fixture/install';
      const installation = await resolveRunnerInstallation(location);
      window.__dropSaves = [];
      const owner = window.__dropOwner = new RunnerSessions({}, undefined, {},
        (id, value) => window.__dropSaves.push({ id, value }));
      owner.setInstallation(installation);
      const source = owner.create(location, undefined, 'task-run');
      const destination = owner.create(location, undefined, 'issue-run');
      window.__dropSessions = [source.session, destination.session];
      await Promise.all([source.launched, destination.launched]);
    });
    await expect.poll(() => page.evaluate(() => {
      const [session] = window.__dropSessions;
      return window.__dropOwner.getSelections(session.view.id).canSetTabMode('issue-run');
    })).toBe(true);
    const rejected = await page.evaluate(() => {
      const owner = window.__dropOwner;
      const [session, peer] = window.__dropSessions;
      const id = session.view.id, peerId = peer.view.id;
      const choices = owner.getSelections(id), token = Symbol();
      const drop = { id, source: { domain: 'task-run', ids: [id] },
        destination: { domain: 'issue-run', ids: [peerId] }, before: peerId };
      const read = () => ({ navigation: owner.navigation.snapshot, settings: structuredClone(choices.defaults),
        stored: localStorage.getItem('agent-runner-hub.workspace.v1'), writes: window.__dropSaves.length });
      window.__readDrop = read;
      const attempt = window.__tryDrop = () => owner.dropRunner([], 'run-mode', drop);
      const initial = read();
      const supported = choices.catalog.options.run_modes;
      choices.catalog.options.run_modes = supported.filter(mode => mode !== 'issue-run');
      const unsupportedEligible = owner.canDropRunner(id, 'task-run', 'issue-run');
      attempt();
      const afterUnsupported = read();
      choices.catalog.options.run_modes = supported;
      const locked = session.reserve(token);
      const lockedEligible = owner.canDropRunner(id, 'task-run', 'issue-run');
      attempt();
      const afterLock = read();
      session.release(token);
      return { id, peerId, locked, lockedEligible, unsupportedEligible, initial, afterLock, afterUnsupported };
    });
    expect(rejected.locked).toBe(true);
    expect(rejected.lockedEligible).toBe(false);
    expect(rejected.unsupportedEligible).toBe(false);
    expect(rejected.afterLock).toEqual(rejected.initial);
    expect(rejected.afterUnsupported).toEqual(rejected.initial);
    await expect.poll(() => page.evaluate(id => window.__dropOwner.canDropRunner(id, 'task-run', 'issue-run'), rejected.id))
      .toBe(true);
    const result = await page.evaluate(() => {
      const owner = window.__dropOwner;
      const read = window.__readDrop;
      const ready = read();
      const observed = [];
      const unsubscribe = owner.subscribe(() => observed.push(read()));
      window.__tryDrop();
      const accepted = read();
      unsubscribe();
      owner.dispose();
      return { ready, observed, accepted };
    });
    expect(result.accepted.settings).toEqual({ ...result.ready.settings, runMode: 'issue-run' });
    expect(result.accepted.writes).toBe(result.ready.writes + 1);
    expect(result.accepted.navigation.order).toEqual([rejected.id, rejected.peerId]);
    expect(result.accepted.navigation.affinities[rejected.id]).toBe('issue-run');
    expect(result.observed.length).toBeGreaterThan(0);
    for (const snapshot of result.observed) {
      expect(snapshot.navigation).toEqual(result.accepted.navigation);
      expect(snapshot.settings).toEqual(result.accepted.settings);
    }
  });
}
