import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test.use({ navigationTimeout: 60_000 });
test.setTimeout(90_000);

const longName = 'A very long Runner name that must remain intact when truncated in the sidebar';

test('Runner order, truncation, selection and inline rename preserve navigation identity', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/tests/fixtures/hub.html');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  const rows = page.locator('.runner-row');
  expect(await rows.evaluateAll(items => items.slice(0, 3).map(item => item.dataset.runnerId))).toEqual(['first', 'second', 'third']);
  await expect(nav.locator('.nav-row').first()).toHaveAccessibleName('Single Entry');
  const longRow = page.locator('[data-runner-id="second"]');
  await expect(longRow.locator('.runner-name')).toHaveText(longName);
  expect(await longRow.locator('.runner-name').evaluate(node => ({
    truncated: node.scrollWidth > node.clientWidth,
    overflow: getComputedStyle(node).textOverflow,
    whiteSpace: getComputedStyle(node).whiteSpace,
    rowHeight: node.closest('li').getBoundingClientRect().height,
  }))).toEqual({ truncated: true, overflow: 'ellipsis', whiteSpace: 'nowrap', rowHeight: 36 });
  await longRow.locator('.nav-row').click();
  await expect(page.locator('.workspace-header')).toHaveCount(0);
  await expect(longRow.locator('.nav-row')).toHaveAttribute('aria-current', 'page');
  await expect(longRow.locator('.remove-action')).toBeVisible();
  await expect(page.locator('.workspace .context-settings')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Runner name', exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(longName);
  await input.fill('Renamed locally');
  await input.press('Enter');
  await expect(longRow.locator('.nav-row')).toBeFocused();
  await expect(longRow.locator('.runner-name')).toHaveText('Renamed locally');
  await expect(longRow.locator('.nav-row')).toHaveAttribute('aria-current', 'page');
  expect(await rows.evaluateAll(items => items.slice(0, 3).map(item => item.dataset.runnerId))).toEqual(['first', 'second', 'third']);
  await longRow.locator('.nav-row').dblclick();
  await input.fill('Discard this');
  await input.press('Escape');
  await expect(longRow.locator('.runner-name')).toHaveText('Renamed locally');
  await expect(longRow.locator('.nav-row')).toBeFocused();
  await page.keyboard.press('F2');
  await input.fill('  ');
  await input.press('Enter');
  await expect(longRow.locator('.runner-name')).toHaveText('Renamed locally');
  await page.keyboard.press('F2');
  await input.fill('Saved on blur');
  await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  await expect(longRow.locator('.runner-name')).toHaveText('Saved on blur');
  await expect(page.locator('.workspace-header')).toHaveCount(0);
  await longRow.locator('.nav-row').click();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(longRow.locator('.nav-row')).toHaveAttribute('aria-current', 'page');
  await testInfo.attach('selected-black', { body: await page.screenshot(), contentType: 'image/png' });
});

test('keyboard navigation and scrolling keep Single Entry accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto('/tests/fixtures/hub.html');
  const entry = page.getByRole('button', { name: 'Single Entry', exact: true });
  const first = page.locator('[data-runner-id="first"] .nav-row');
  await entry.focus();
  await page.keyboard.press('ArrowDown');
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-current', 'page');
  const entryTop = (await entry.boundingBox()).y;
  await page.keyboard.press('End');
  await expect(page.locator('.add-runner')).toBeFocused();
  await expect(entry).toBeInViewport();
  expect((await entry.boundingBox()).y).toBe(entryTop);
  await page.keyboard.press('Home');
  await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await testInfo.attach('resized-navigation', { body: await page.screenshot(), contentType: 'image/png' });
});

for (const theme of ['Light', 'Black']) {
  test(`${theme} covers every surface and remains usable when resized`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto('/tests/fixtures/hub.html');
    await page.locator('[data-runner-id="third"] .nav-row').click();
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    const surfaces = ['.toolbar', '.sidebar', '.workspace', '.composer', 'select', '.theme-picker', '.runner-row.active', '.send-button'];
    const colors = await page.evaluate(selectors => selectors.map(selector =>
      getComputedStyle(document.querySelector(selector)).backgroundColor), surfaces);
    const expected = theme === 'Light'
      ? ['rgb(245, 245, 244)', 'rgb(241, 242, 243)', 'rgba(0, 0, 0, 0)', 'rgb(250, 250, 250)', 'rgb(250, 250, 250)', 'rgb(241, 242, 243)', 'rgb(220, 233, 251)', 'rgb(236, 238, 241)']
      : ['rgb(25, 26, 29)', 'rgb(23, 24, 27)', 'rgba(0, 0, 0, 0)', 'rgb(21, 22, 25)', 'rgb(21, 22, 25)', 'rgb(23, 24, 27)', 'rgb(38, 60, 89)', 'rgb(38, 40, 45)'];
    expect(colors).toEqual(expected);
    await expect(page.locator('.hub')).toHaveCSS('background-color', theme === 'Light' ? 'rgb(255, 255, 255)' : 'rgb(17, 18, 20)');
    const active = page.locator('.runner-row.active .nav-row');
    await expect(page.getByRole('button', { name: theme, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await active.focus();
    await expect(active).toHaveCSS('outline-style', 'solid');
    await expect(active).toHaveCSS('outline-width', '2px');
    await testInfo.attach(`${theme}-1000x700`, { body: await page.screenshot(), contentType: 'image/png' });
    for (const size of [{ width: 760, height: 560 }, { width: 626, height: 450 }, { width: 1400, height: 900 }]) {
      await page.setViewportSize(size);
      await expect(page.getByRole('button', { name: 'Send instruction' })).toBeInViewport();
      await expect(page.getByRole('textbox', { name: 'Runner instructions' })).toBeInViewport();
      await expect(page.locator('.composer-note')).toBeInViewport();
      expect((await page.locator('.output').boundingBox()).height).toBeGreaterThan(90);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`${theme}-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  });
}
