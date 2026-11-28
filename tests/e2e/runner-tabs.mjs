import { chooseAppPreference } from './application-menu.mjs';
export function registerRunnerTabs({ test, expect, transport, configure, create }) {
  const row = (page, name) => page.locator('.runner-row').filter({ has: page.getByText(name, { exact: true }) });
  const home = page => page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  const middle = async locator => {
    await locator.locator('.nav-row').click({ button: 'middle' });
    await locator.page().getByRole('dialog').getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
  };
  async function ready(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
  }
  async function assign(page) {
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('observe exactly this work');
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).press('Enter');
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ started_event_id: expect.any(Number), work_id: expect.any(Object) })]));
  }
  for (const language of ['en', 'ko']) for (const [outcome, state, label] of [
    ['succeeded', 'idle', ['Verified idle', '검증된 유휴 상태']], ['failed', 'idle', ['Verified idle', '검증된 유휴 상태']],
    ['interrupted', 'idle', ['Verified idle', '검증된 유휴 상태']],
  ]) {
    test(`runner tabs background ${outcome} unread and continued discovery without replay ${language}`, async ({ page }, info) => {
      await ready(page); await assign(page); await create(page);
      await chooseAppPreference(page, 'settings', 'language', language);
      await page.keyboard.press('Escape');
      await page.evaluate(outcome => { window.__nativeFixture.sessions.get('pty-1').feature.mode = outcome; }, outcome);
      const own = row(page, 'Runner 1'), neighbor = row(page, 'Runner 2');
      const positions = () => page.locator('.runner-row').evaluateAll(rows => rows.map(row => {
        const marker = row.querySelector('.status-dot').getBoundingClientRect();
        return [marker.x + marker.width / 2, row.querySelector('.runner-name').getBoundingClientRect().x];
      }));
      const beforeUnread = await positions();
      await expect(own.locator(`.status-dot.${state}`)).toHaveAttribute('aria-label', label[language === 'en' ? 0 : 1]);
      await expect(own.locator('.unread-completion')).toBeVisible();
      expect(await positions()).toEqual(beforeUnread);
      await expect(neighbor.locator('.unread-completion')).toHaveCount(0);
      await expect(neighbor.locator('.nav-row')).toHaveAttribute('aria-current', 'page');
      const before = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length);
      await page.waitForTimeout(1700);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(before);
      await info.attach(`tab-${outcome}-${language}`, { body: await page.screenshot({ path: info.outputPath('tab-status.png') }), contentType: 'image/png' });
      await chooseAppPreference(page, 'settings', 'language', language === 'en' ? 'ko' : 'en');
      await page.keyboard.press('Escape');
      await expect(own.locator('.unread-completion')).toBeVisible();
      await neighbor.locator('.nav-row').dblclick();
      await page.locator('.rename-row input').fill('Neighbor');
      await page.locator('.rename-row input').press('Enter');
      await expect(own.locator('.unread-completion')).toBeVisible();
      await own.locator('.nav-row').click();
      await expect(own.locator('.unread-completion')).toHaveCount(0);
      await row(page, 'Neighbor').locator('.nav-row').click();
      await expect(own.locator('.status-dot')).toHaveClass(new RegExp(state));
      await expect(own.locator('.unread-completion')).toHaveCount(0);
      const evidence = await page.evaluate(() => {
        const f = window.__nativeFixture.sessions.get('pty-1').feature;
        return { original: f.work.submission_request_id, requests: f.requests,
          saved: localStorage.getItem('agent-runner-hub.workspace.v1') };
      });
      expect(evidence.requests.filter(r => r.operation === 'work.submit')).toHaveLength(1);
      expect(evidence.requests.filter(r => r.operation === 'work.status').every(r => r.submission_request_id === evidence.original)).toBe(true);
      expect(evidence.saved).not.toMatch(/submission_request|work_id|execution_id|unread|observe exactly/);
      await page.reload();
      await expect(page.locator('.unread-completion')).toHaveCount(0);
      await expect(page.locator('.status-dot.completed')).toHaveCount(0);
    });
  }
  for (const observation of ['fresh', 'unavailable', 'unverified', 'rejected']) {
    test(`runner tabs completed TaskRun requires fresh authority for idle: ${observation}`, async ({ page }) => {
      await ready(page); await assign(page);
      const marker = row(page, 'Runner 1').locator('.status-dot');
      await expect(marker).toHaveClass('status-dot running');
      await expect(marker).toHaveCSS('color', 'rgb(59, 130, 246)');
      await page.evaluate(async observation => {
        const s = window.__nativeFixture.sessions.get('pty-1');
        s.feature.mode = 'succeeded';
        if (observation === 'unavailable') s.control.observation = null;
        if (observation === 'unverified') s.control.unverified = true;
        if (observation === 'rejected') Object.assign(s.control, { state: 'disconnected',
          observationFailure: { requestId: 901, status: 'failure', phase: 'completed', code: 'DISPATCH_FAILED' },
          detail: 'Runner observation was rejected (observe request 901, status failure, phase completed, code DISPATCH_FAILED)' });
        await window.__nativeFixture.publish('pty-1');
      }, observation);
      await expect(marker).toHaveClass(`status-dot ${observation === 'fresh' ? 'idle' : 'unknown'}`);
      await expect(marker).toHaveAttribute('aria-label', observation === 'fresh' ? 'Verified idle' : 'Status unknown');
      await expect(marker).toHaveCSS('color', observation === 'fresh' ? 'rgb(34, 197, 94)' : 'rgb(156, 163, 175)');
      if (observation !== 'fresh') {
        const draft = page.locator('.runner-composer textarea');
        await draft.fill('must remain unsent'); await draft.press('Enter');
        await expect(draft).toHaveValue('must remain unsent');
      }
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests
        .filter(r => r.operation === 'work.submit').length)).toBe(1);
    });
  }
  for (const [outcome, state] of [['suspended', 'attention'], ['incomplete', 'attention'], ['unknown', 'unknown']]) {
    test(`runner tabs retains nonterminal ${outcome} without completion`, async ({ page }) => {
      await ready(page); await assign(page); await home(page);
      await page.evaluate(outcome => { window.__nativeFixture.sessions.get('pty-1').feature.mode = outcome; }, outcome);
      const own = row(page, 'Runner 1');
      await expect(own.locator('.status-dot')).toHaveClass(new RegExp(state));
      await expect(own.locator('.unread-completion')).toHaveCount(0);
      await own.locator('.remove-action').click();
      await page.keyboard.press('Escape');
      await expect(own).toBeVisible();
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    });
  }
  for (const language of ['en', 'ko']) {
    test(`runner tabs active sidebar removal confirms ${language}`, async ({ page }, info) => {
      await ready(page); await assign(page); await home(page);
      const own = row(page, 'Runner 1');
      await expect(own.locator('.status-dot.running')).toBeVisible();
      await own.locator('.remove-action').click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.workspace-header')).toHaveCount(0);
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
      await own.locator('.nav-row').click();
      await chooseAppPreference(page, 'settings', 'language', language);
      await page.keyboard.press('Escape');
      await own.locator('.remove-action').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(language === 'en' ? 'active, suspended or uncertain work' : '결과가 불확실한 작업');
      await expect(dialog.getByRole('button', { name: language === 'en' ? 'Keep tab open' : '탭 유지' })).toBeFocused();
      await info.attach(`close-confirm-${language}`, { body: await page.screenshot({ path: info.outputPath('close-confirm.png') }), contentType: 'image/png' });
      await dialog.getByRole('button', { name: language === 'en' ? 'Keep tab open' : '탭 유지' }).click();
      await expect(own).toBeVisible();
      expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
      await own.locator('.remove-action').click();
      await dialog.getByRole('button', { name: language === 'en' ? 'Terminate and close tab' : '종료하고 탭 닫기' }).click();
      await expect(own).toHaveCount(0);
      await expect(page.locator('.workspace-header')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toEqual([]);
      const before = await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.length);
      await page.waitForTimeout(1700);
      expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.length)).toBe(before);
    });
  }
  test('runner tabs actual idle middle-click removes exact rows and selects next or Single Entry', async ({ page }) => {
    await ready(page); await create(page); await create(page); await create(page);
    await row(page, 'Runner 2').locator('.nav-row').click();
    await middle(row(page, 'Runner 1'));
    await expect(row(page, 'Runner 1')).toHaveCount(0);
    await expect(row(page, 'Runner 2').locator('.nav-row')).toHaveAttribute('aria-current', 'page');
    await middle(row(page, 'Runner 2'));
    await expect(row(page, 'Runner 2')).toHaveCount(0);
    await expect(row(page, 'Runner 3').locator('.nav-row')).toHaveAttribute('aria-current', 'page');
    await middle(row(page, 'Runner 3'));
    await expect(page.locator('.runner-row')).toHaveCount(0);
    await expect(page.locator('.workspace-header')).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-4').control.state)).toBe('ready');
  });
  test('runner tabs persistence failure retains live row and retry removes it', async ({ page }) => {
    await ready(page); await create(page);
    await page.evaluate(() => {
      const saved = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'agent-runner-hub.workspace.v1' && JSON.parse(value).tabs.length === 0) throw new Error('fixture quota failure');
        return saved.call(this, key, value);
      };
      window.__restoreStorage = () => { Storage.prototype.setItem = saved; };
    });
    const own = row(page, 'Runner 1');
    await middle(own);
    await expect(page.getByRole('alert').filter({ hasText: 'fixture quota failure' }).first()).toBeVisible();
    await expect(own).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs)).toHaveLength(1);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await home(page);
    await own.locator('.nav-row').click();
    await expect(page.getByRole('alert').filter({ hasText: 'fixture quota failure' }).first()).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('pty-1: 안녕');
    await page.evaluate(() => window.__restoreStorage());
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('unsent draft');
    await middle(own);
    await expect(own).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.closed)).toEqual(['pty-1']);
  });
  test('runner tabs report preference cleanup failure and retry stale settings at startup', async ({ page }) => {
    await ready(page); await create(page);
    const id = await page.evaluate(() => {
      const id = JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0].id;
      const saved = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'agent-runner-hub.preferences.v1' && !JSON.parse(value).runnerSelections[id])
          throw new Error('fixture preference storage denied');
        return saved.call(this, key, value);
      };
      return id;
    });
    await middle(row(page, 'Runner 1'));
    await expect(page.getByRole('alert').filter({ hasText: 'fixture preference storage denied' })).toBeVisible();
    await expect(row(page, 'Runner 1')).toHaveCount(0);
    await page.reload();
    await expect(row(page, 'Runner 1')).toHaveCount(0);
    await expect.poll(() => page.evaluate(id =>
      Object.hasOwn(JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).runnerSelections, id), id)).toBe(false);
  });
}
