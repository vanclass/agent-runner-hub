export function registerRunnerNavigation({ test, expect, transport, configure, create }) {
  const modes = ['pure-direct-run', 'direct-run', 'task-run', 'issue-run'];
  const domain = (page, mode) => page.locator(`[data-domain="${mode}"]`);
  const ids = locator => locator.locator('.runner-row').evaluateAll(rows => rows.map(r => r.dataset.runnerId));
  async function display(page, value) {
    await page.locator('.app-settings-trigger').click();
    await page.locator('.domain-preference select').selectOption(value);
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
    await expect(page.locator('.runner-domain')).toHaveCount(0);
    await publish(page, 'pty-1', 'task-run');
    await expect(domain(page, 'task-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await publish(page, 'pty-1', 'issue-run', true, 'unknown');
    await expect(domain(page, 'issue-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await expect(domain(page, 'task-run').locator('.runner-row')).toHaveCount(0);
    await expect(domain(page, 'issue-run').locator('.status-dot.unknown')).toBeVisible();
    const presentation = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation);
    expect(presentation.executedModes).toEqual(['task-run', 'issue-run']);
    expect(presentation.affinities[id]).toBe('issue-run');
    await info.attach('unknown-outcome-domain', { body: await page.screenshot(), contentType: 'image/png' });
    await page.reload();
    await expect(domain(page, 'issue-run').locator('.runner-row')).toHaveAttribute('data-runner-id', id);
    await expect(domain(page, 'task-run').locator('.runner-row')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).presentation)).toEqual(presentation);
    await info.attach('unknown-outcome-restored', { body: await page.screenshot(), contentType: 'image/png' });
  });
  async function mouseMove(page, from, to, after, info) {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + 45, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 50, a.y + a.height / 2 + 8, { steps: 5 });
    await page.mouse.move(b.x + 50, after ? b.y + b.height - 2 : b.y + 2, { steps: 12 });
    await expect(page.locator('.drop-before, .drop-end')).toHaveCount(1);
    const marker = page.locator('.drop-before, .drop-end');
    expect(await marker.evaluate(node => {
      const style = getComputedStyle(node, node.classList.contains('drop-before') ? '::before' : '::after');
      return { display: style.display, height: style.height, color: style.backgroundColor };
    })).toEqual({ display: 'block', height: '3px', color: 'rgb(40, 95, 165)' });
    await info.attach('navigation-insertion', { body: await page.screenshot(), contentType: 'image/png' });
    await page.mouse.up();
  }
  test('navigation production domains observe starts, persist, add and reorder without changing ownership', async ({ page }, info) => {
    await transport(page, undefined, { auto: true, work: true }); await configure(page);
    await expect(domain(page, 'runner')).toBeVisible(); await expect(domain(page, 'runner').locator('.runner-row')).toHaveCount(0);
    await create(page);
    await display(page, 'run-mode');
    await expect(page.locator('.runner-domain, .add-runner')).toHaveCount(0);
    await publish(page, 'pty-1', 'issue-run', false);
    await page.waitForTimeout(2100);
    await expect(page.locator('.runner-domain')).toHaveCount(0);
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
    await mouseMove(page, rows.nth(2), rows.nth(0), false, info);
    await expect.poll(() => ids(task)).toEqual([original[2], original[0], original[1]]);
    await mouseMove(page, rows.nth(0), rows.nth(2), true, info);
    await expect.poll(() => ids(task)).toEqual(original);
    await mouseMove(page, rows.nth(0), rows.nth(1), true, info);
    await expect.poll(() => ids(task)).toEqual([original[1], original[0], original[2]]);
    await rows.first().dragTo(domain(page, 'issue-run').locator('.runner-row'));
    expect(await ids(task)).toEqual([original[1], original[0], original[2]]);
    await expect(page.locator('.drop-before, .drop-end')).toHaveCount(0);
    await expect(page.locator('.runner-row.active')).toHaveAttribute('data-runner-id', selected);
    await expect(page.locator('.composer textarea')).toHaveValue('navigation draft');
    const after = await page.evaluate(() => ({ tabs: JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs,
      native: [...window.__nativeFixture.sessions.keys()], closed: window.__nativeFixture.closed }));
    expect(after).toEqual(ownership);
    for (const d of await page.locator('.runner-domain').all()) {
      const add = await d.locator('.add-runner').boundingBox(), last = await d.locator('.runner-row').last().boundingBox();
      expect(add.y).toBeGreaterThanOrEqual(last.y + last.height);
      await expect(d.locator('.add-runner')).toHaveCSS('background-color', 'rgb(22, 129, 61)');
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
      await page.locator('.app-settings-trigger').click();
      await page.locator('.language-picker select').selectOption(language);
      await page.locator('.theme-picker button').nth(theme === 'light' ? 0 : 1).click();
      await expect(page.locator('.domain-preference select')).toHaveValue('run-mode');
      await page.keyboard.press('Escape');
      await expect(page.locator('.runner-domain')).toHaveCount(4);
      await expect(page.locator('.hub')).toHaveAttribute('data-theme', theme);
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
}
