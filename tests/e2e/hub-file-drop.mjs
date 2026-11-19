import { readFileSync } from 'node:fs';
export function registerHubFileDrop({ test, expect, transport, configure, create }) {
  async function ready(page) {
    await transport(page, undefined, { work: true, clipboard: true, auto: true });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      const records = Array.from({ length: 100 }, (_, i) => ({ sequence: i + 1, timestamp: 1,
        component: 'system', operation: 'fixture', runner: '', target: '', expected: '', actual: 'ready',
        code: `fixed log ${i}`, nextAction: '' }));
      native.invoke = (command, args) => command === 'hub_log' ? Promise.resolve({ records, issue: null }) : original(command, args);
    });
    await configure(page); await create(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })).toBeEnabled();
  }
  async function event(page, type, selector = '.toolbar', paths = ['/fixture/image.png']) {
    await page.locator(selector).evaluate((node, { type, paths }) => {
      const r = node.getBoundingClientRect();
      window.__nativeFixture.nativeEvent(`tauri://drag-${type}`, { paths,
        position: { x: (r.left + r.width / 2) * devicePixelRatio, y: (r.top + r.height / 2) * devicePixelRatio } });
    }, { type, paths });
  }
  test('Hub native drops route once across regions and retain inactive ownership', async ({ page }) => {
    await ready(page);
    const listeners = await page.evaluate(() => window.__nativeFixture.dragListeners());
    expect(listeners).toHaveLength(4);
    for (const selector of ['.toolbar', '.sidebar', '.terminal-host', '.attachment-composer', '.task-panel']) {
      await event(page, 'drop', selector, ['/fixture/folder']);
    }
    await expect(page.locator('.attachment-chip')).toHaveCount(5);
    await event(page, 'enter');
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    await page.locator('.workspace').evaluate(node => {
      const dataTransfer = new DataTransfer(); dataTransfer.setData('text/plain', 'sidebar reorder');
      node.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
    });
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await event(page, 'drop', '.hub-log-records');
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    expect(await page.evaluate(() => window.__nativeFixture.dragListeners())).toEqual(listeners);
    await page.locator('.runner-row .nav-row').first().click();
    await expect(page.locator('.attachment-chip')).toHaveCount(5);
    await event(page, 'enter');
    await expect(page.locator('.workspace.attachment-drop-active')).toBeVisible();
    await expect(page.locator('.attachment-drop-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.attachment-drop-hint')).toHaveCount(0);
    await event(page, 'enter');
    expect(await page.locator('.workspace').evaluate(node => {
      const style = getComputedStyle(node, '::after');
      return [style.position, style.top, style.right, style.bottom, style.left, style.pointerEvents];
    })).toEqual(['absolute', '0px', '0px', '0px', '0px', 'none']);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await page.locator('.preview-help button').click();
    await expect(page.locator('.attachment-drop-hint')).toHaveCount(0);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.locator('.preview-help button').click();
    await expect(page.locator('.attachment-drop-hint')).toHaveCount(0);
    await event(page, 'enter');
    await expect(page.locator('.attachment-drop-hint')).toBeVisible();
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await expect(page.locator('.attachment-drop-hint')).toHaveCount(0);
    await event(page, 'drop');
    await expect(page.locator('.attachment-chip')).toHaveCount(5);
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.request.operation !== 'references.list'))).toEqual([]);
  });
  for (const single of [false, true]) test(`Hub deduplicates paths within one drop for ${single ? 'Single Entry' : 'Runner'}`, async ({ page }) => {
    await ready(page);
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await event(page, 'drop', '.toolbar', ['/fixture/folder', '/fixture/image.png', '/fixture/folder', '/fixture/image.png']);
    await expect(page.locator('.attachment-chip')).toHaveCount(2);
    await expect(page.locator('.attachment-open[title="/fixture/folder"]')).toHaveCount(1);
    await expect(page.locator('.attachment-open[title="/fixture/image.png"]')).toHaveCount(1);
    if (single) await page.locator('.runner-row .nav-row').first().click();
    else await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    else await page.locator('.runner-row .nav-row').first().click();
    await expect(page.locator('.attachment-chip')).toHaveCount(2);
    await event(page, 'drop', '.attachment-composer', ['/fixture/folder', '/fixture/folder']);
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    await expect(page.locator('.attachment-open[title="/fixture/folder"]')).toHaveCount(2);
    expect(await page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.request.operation !== 'references.list'))).toEqual([]);
  });
  for (const language of ['en', 'ko']) test(`Hub drag feedback preserves fixed scrollback in rendered xterm and Hub log ${language}`, async ({ page }, info) => {
    await ready(page);
    const catalog = JSON.parse(readFileSync(new URL(`../../src/hub/locales/${language}.json`, import.meta.url), 'utf8'));
    if (language === 'ko') {
      await page.getByRole('button', { name: 'App settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption(language);
      await page.locator('.settings-close').click();
    }
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', Array.from({ length: 120 }, (_, i) => `fixed row ${i}\r\n`).join('')));
    await expect(page.locator('.xterm-rows')).toContainText('fixed row 119');
    const measurements = [];
    for (const single of [false, true]) {
      if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      const selector = single ? '.hub-log-records' : '.xterm-screen';
      const viewport = page.locator(selector);
      if (single) await viewport.evaluate(node => { node.scrollTop = node.scrollHeight / 3; node.dispatchEvent(new Event('scroll')); });
      else {
        await viewport.hover(); await page.mouse.wheel(0, -700);
        await expect(page.locator('.xterm-rows')).not.toContainText('fixed row 119');
        await expect(page.locator('.xterm-rows')).toContainText('fixed row');
      }
      const measure = () => page.evaluate(selector => {
        const node = document.querySelector(selector), rect = node.getBoundingClientRect();
        const rows = document.querySelector('.xterm-rows');
        return { height: rect.height, top: rect.top, scroll: node.scrollTop,
          text: rows?.textContent ?? node.textContent, resizes: window.__nativeFixture.resizes.length };
      }, selector);
      await page.waitForTimeout(200);
      const before = await measure();
      const exposedBefore = await viewport.screenshot();
      await info.attach(single ? 'entry-before' : 'runner-before', { body: exposedBefore, contentType: 'image/png' });
      if (single) expect(await viewport.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await event(page, 'enter');
      await expect(page.locator('.workspace.attachment-drop-active')).toBeVisible();
      await expect(page.locator('.attachment-composer.attachment-drop-active')).toHaveCount(0);
      await expect(page.locator('.attachment-drop-hint')).toHaveText(catalog.attachments[single ? 'dropEntry' : 'dropRunner']);
      await expect(page.locator('.attachment-drop-hint')).toHaveCSS('position', 'absolute');
      await expect(page.locator('.attachment-drop-hint')).toHaveCSS('pointer-events', 'none');
      await page.waitForTimeout(200);
      const during = await measure(); expect(during).toEqual(before);
      const exposedDuring = await viewport.screenshot();
      await info.attach(single ? 'entry-during' : 'runner-during', { body: exposedDuring, contentType: 'image/png' });
      expect(exposedDuring.equals(exposedBefore), 'Hover must preserve every exposed log pixel').toBe(true);
      await info.attach(single ? 'entry-hover' : 'runner-hover', { body: await page.screenshot(), contentType: 'image/png' });
      await page.evaluate(() => window.__nativeFixture.nativeEvent('tauri://drag-leave', {}));
      await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
      await page.waitForTimeout(200);
      const after = await measure(); expect(after).toEqual(before);
      const exposedAfter = await viewport.screenshot();
      await info.attach(single ? 'entry-after' : 'runner-after', { body: exposedAfter, contentType: 'image/png' });
      expect(exposedAfter.equals(exposedBefore), 'Leave must preserve every exposed log pixel').toBe(true);
      measurements.push({ destination: single ? 'entry' : 'runner', before, during, after });
    }
    await info.attach('viewport-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });
}
