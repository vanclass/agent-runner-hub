export function registerHubShortcuts({ test, expect, transport, configure, create, foreground }) {
  const home = page => page.keyboard.press('Home');
  const rows = page => page.locator('.runner-row .nav-row');
  async function ready(page, options = {}) {
    await transport(page, undefined, { auto: true, work: true, ...options });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('textbox', { name: 'Requested Direct / Pure Direct Root', exact: true }).fill('C:/explicit-root');
  }
  async function remap(page) {
    await page.locator('.shortcut-settings-trigger').click();
    for (const [action, chord] of [['Assign instruction', 'Alt+Enter'], ['Go to Single Entry', 'Alt+Home'], ['Go to Runner by position', 'Alt+2']]) {
      await page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click();
      await page.keyboard.press(chord);
    }
    await page.getByRole('button', { name: 'Apply and save', exact: true }).click();
  }
  test('shortcuts assign exactly once with defaults and custom restored keys through Single Entry', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Control+Enter');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
    await page.locator('.composer textarea').fill('default shortcut once');
    await page.keyboard.down('Control'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
    await page.keyboard.up('Enter'); await page.keyboard.up('Control');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
    await home(page); await remap(page); await page.reload();
    await expect(page.locator('.spare-status')).toHaveCount(0);
    await page.locator('.composer textarea').fill('custom shortcut once');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.composer textarea')).toHaveValue('custom shortcut once');
    await page.keyboard.press('Alt+Enter');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event', { timeout: 35000 });
    const requests = await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests).filter(r => r.operation === 'work.submit'));
    expect(requests.filter(r => r.instruction === 'custom shortcut once')).toHaveLength(1);
  });
  test('shortcuts use current order after removal rename addition and custom reload without closing sessions', async ({ page }) => {
    await ready(page); await create(page); await create(page); await create(page); await home(page);
    await page.locator('.composer textarea').fill('retained draft');
    await page.keyboard.press('Control+1'); await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Control+2'); await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'page');
    const thirdId = await page.locator('.runner-row').nth(2).getAttribute('data-runner-id');
    await rows(page).nth(1).click({ button: 'middle' });
    await page.getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.keyboard.press('Control+2');
    await expect(page.locator(`[data-runner-id="${thirdId}"] .nav-row`)).toHaveAttribute('aria-current', 'page');
    await rows(page).nth(1).dblclick(); await page.locator('.rename-row input').fill('Renamed third');
    await page.locator('.rename-row input').press('Enter'); await create(page);
    await page.keyboard.press('Control+2'); await expect(rows(page).nth(1)).toContainText('Renamed third');
    await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'page');
    const before = await page.evaluate(() => ({ count: window.__nativeFixture.count(), closed: window.__nativeFixture.closed.length }));
    await home(page); await expect(page.locator('.composer textarea')).toHaveValue('retained draft');
    await remap(page); await page.keyboard.press('Alt+2');
    await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Alt+Home'); await expect(page.locator('.composer textarea')).toHaveValue('retained draft');
    expect(await page.evaluate(() => ({ count: window.__nativeFixture.count(), closed: window.__nativeFixture.closed.length }))).toEqual(before);
    await page.reload(); await expect(rows(page)).toHaveCount(3);
    await page.keyboard.press('Alt+2'); await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Alt+Home'); await expect(page.locator('.composer textarea')).toBeVisible();
  });
  test('shortcuts arbitrate xterm keydown keyup clipboard composition repeat and modal capture', async ({ page }) => {
    await ready(page); await create(page); await create(page);
    const terminal = page.locator('.xterm-helper-textarea');
    await terminal.focus();
    await page.evaluate(() => { window.__nativeFixture.writes.length = 0; });
    await page.keyboard.press('Home'); await expect(page.locator('.composer textarea')).toBeFocused();
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    await page.keyboard.press('Control+1'); await expect(rows(page).nth(0)).toBeFocused(); await terminal.focus();
    await foreground(page, 'pty-1', true);
    await page.evaluate(() => { window.__nativeFixture.writes.length = 0; });
    await page.keyboard.press('x');
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
    await terminal.evaluate(node => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', code: 'Home', isComposing: true, bubbles: true }));
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'page');
    await page.locator('.shortcut-settings-trigger').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Go to Single Entry', exact: true }).click();
    await page.keyboard.press('Control+Enter');
    await expect(dialog.getByRole('alert')).toContainText('overlap');
    await expect(dialog.getByRole('button', { name: 'Apply and save' })).toBeDisabled();
    await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'page');
    await dialog.getByRole('button', { name: 'Restore defaults' }).click();
    await dialog.getByRole('button', { name: 'Go to Single Entry', exact: true }).click();
    await page.keyboard.press('Control+v');
    await expect(dialog.getByRole('alert')).toContainText('reserved');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(page.locator('.shortcut-settings-trigger')).toBeFocused();
    await terminal.focus(); await page.keyboard.press('Home');
    await expect(page.locator('.composer textarea')).toBeFocused();
  });
  test('shortcuts never replay pending assignments', async ({ page }) => {
    await ready(page, { workMode: 'admitted' });
    await page.locator('.composer textarea').fill('pending shortcut'); await page.keyboard.press('Control+Enter');
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('start unconfirmed', { timeout: 35000 });
    await home(page); await page.keyboard.press('Control+Enter');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(1);
    await expect(page.locator('.composer textarea')).toHaveValue('pending shortcut');
  });
  test('shortcuts retain instructions when attachment preflight rejects assignment', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').items.push({
      reference_id: 'a'.repeat(32), display_index: 1, display_name: 'unconfirmed', kind: 'file' }));
    await page.locator('.composer textarea').fill('preflight shortcut'); await page.keyboard.press('Control+Enter');
    await home(page);
    await expect(page.getByRole('button', { name: 'Release unsent assignment' })).toBeVisible();
    await expect(page.locator('.composer textarea')).toHaveValue('preflight shortcut');
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests)).toEqual([]);
  });
}
