import { appTrigger } from './application-menu.mjs';
import { PNG } from 'pngjs';
import { registerAttachmentOutcomes } from './attachment-outcomes.mjs';
import { registerLocalPreviews } from './local-previews.mjs';
import { registerPreviewViews } from './preview-views.mjs';
import { HubActions } from '../native/webdriver/hub-actions.mjs';
import { testBrowser } from './test-browser.mjs';
const png = [...PNG.sync.write({ width: 1, height: 1, data: Buffer.from([31, 87, 201, 255]) })];
const actions = page => new HubActions(testBrowser(page));
async function paste(page, surface = 'runner') {
  return actions(page).attachments.pasteImage(surface, { bytes: png, name: 'paste.png', type: 'image/png' });
}
async function requests(page) {
  return page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.request.operation !== 'references.list'));
}
export async function drop(page, paths) {
  const surface = await page.locator('.runner-composer').count() ? 'runner' : 'single-entry';
  return actions(page).attachments.dropPaths(surface, paths);
}
export function registerComposerAttachments({ test, expect, transport, configure, create }) {
  expect = expect.configure({ timeout: 30000 });
  async function ready(page, options = {}) {
    await transport(page, undefined, { work: true, clipboard: true, auto: true, ...options });
    await configure(page); await create(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true })).toBeEnabled();
  }
  async function send(page, text = 'submit final attachments') {
    const hub = new HubActions(testBrowser(page, expect));
    await hub.draft('runner', text);
    await hub.submit('runner');
  }
  registerAttachmentOutcomes({ test, expect, ready, paste, requests, send, drop });
  registerLocalPreviews({ test, expect, ready, paste, requests, drop });
  registerPreviewViews({ test, expect, ready, drop });
  test('background composer helpers preserve text edits and isolate attachment owners', async ({ page }) => {
    await ready(page);
    const hub = actions(page), attachments = hub.attachments;
    const input = page.locator('textarea[data-instruction]');
    const runner = await hub.activeRunner();
    await hub.draft('runner', 'left middle right');
    await input.evaluate(node => node.setSelectionRange(5, 11));
    expect(await attachments.pasteText('runner', '한글\r\n🌍')).toEqual({ cancelled: false, inserted: true });
    await expect(input).toHaveValue('left 한글\n🌍 right');
    expect(await input.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([10, 10]);
    await input.evaluate(node => node.addEventListener('paste', event => event.preventDefault(), { once: true }));
    expect(await attachments.pasteText('runner', 'ignored')).toEqual({ cancelled: true, inserted: false });
    await expect(input).toHaveValue('left 한글\n🌍 right');
    await attachments.dropPaths('runner', ['/fixture/one.txt', '/fixture/folder']);
    await expect.poll(async () => (await attachments.inventory('runner')).items.map(item => item.path))
      .toEqual(['/fixture/one.txt', '/fixture/folder']);
    await attachments.remove('runner', 0);
    const second = await hub.addRunner();
    expect((await attachments.inventory('runner')).items).toEqual([]);
    await hub.selectSingleEntry();
    await hub.draft('single-entry', '');
    await paste(page, 'single-entry');
    await expect.poll(async () => (await attachments.inventory('single-entry')).items[0]?.thumbnail?.width).toBe(1);
    await hub.selectRunner(runner);
    expect((await attachments.inventory('runner')).items.map(item => item.path)).toEqual(['/fixture/folder']);
    await expect(input).toHaveValue('left 한글\n🌍 right');
    await hub.selectRunner(second);
    expect((await attachments.inventory('runner')).items).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.clipboardReads)).toEqual([]);
  });
  for (const outcome of ['unknown', 'rejected']) test(`IssueRun retains original image and draft on ${outcome}`, async ({ page }) => {
    await ready(page, { workMode: outcome });
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
    await paste(page);
    const input = page.locator('textarea[data-instruction]');
    const draft = 'Original IssueRun draft\nWith an image';
    await input.fill(draft); await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.deliveredSets.length)).toBe(1);
    await expect(input).toHaveValue(draft);
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    if (outcome === 'rejected') { await expect(input).toBeEnabled(); return; }
    await expect(input).toBeDisabled();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.mode = 'started'; });
    await page.locator('.runner-row .nav-row').first().click();
    await expect(input).toHaveValue('');
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    await expect(input).toBeEnabled();
    await input.fill('New draft after late matching start');
    await input.press('Enter');
    await expect(input).toHaveValue('New draft after late matching start');
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets.length)).toBe(1);
  });
  test('IssueRun confirmed start retires image and permits a new draft without terminal input modes', async ({ page }) => {
    await ready(page);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('issue-run'));
    const input = page.locator('textarea[data-instruction]');
    await paste(page);
    await input.fill('Investigate the elapsed timer\nPreserve the paused work.');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    await page.evaluate(() => window.__nativeFixture.emit('pty-1', '\x1b[?9001l\x1b[?2004l'));
    await expect(input).toBeEnabled();
    await input.fill('Independent next draft');
    await input.press('Enter');
    await expect(input).toHaveValue('Independent next draft');
    await expect(input).toBeEnabled();
    await paste(page);
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.locator('.runner-row .nav-row').first().click();
    await expect(input).toHaveValue('Independent next draft');
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests)
      .filter(r => r.operation === 'work.submit').length)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets.length)).toBe(1);
  });
  for (const kind of ['image', 'file', 'mixed']) for (const single of [false, true]) test(`attachment wheel regions ${single ? 'Single Entry' : 'Runner'} ${kind}`, async ({ page }) => {
    await ready(page);
    if (single) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    if (kind !== 'image') await drop(page, Array.from({ length: 80 }, (_, i) => `/fixture/scroll-${i}.txt`));
    if (kind !== 'file') for (let i = 0; i < (kind === 'image' ? 12 : 2); i++)
      await paste(page, single ? 'single-entry' : 'runner');
    const input = page.locator('textarea[data-instruction]');
    await input.fill('editable line\n'.repeat(100));
    await expect.poll(() => page.locator('.attachment-composer').evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
    await input.evaluate(n => { n.scrollTop = 0; });
    await input.hover(); await page.mouse.wheel(0, 240);
    await expect.poll(() => input.evaluate(n => n.scrollTop)).toBeGreaterThan(100);
    const references = page.locator('.composer-reference-content');
    await references.evaluate(n => { n.scrollTop = 0; });
    await references.hover(); await page.mouse.wheel(0, 240);
    await expect.poll(() => references.evaluate(n => n.scrollTop)).toBeGreaterThan(100);
    expect(await page.locator('.composer-area').evaluate(n => n.scrollTop)).toBe(0);
    const before = await page.locator('.attachment-chip').count();
    await page.locator('.attachment-remove').first().click();
    await expect(page.locator('.attachment-chip')).toHaveCount(before - 1);
  });
  test('instruction focus has no outline in either shared composer', async ({ page }, info) => {
    await ready(page);
    for (const label of ['Runner instructions', 'Single Entry instructions']) {
      if (label.startsWith('Single')) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      const input = page.getByRole('textbox', { name: label, exact: true });
      await input.click();
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS('outline-style', 'none');
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS('outline-style', 'none');
      await input.fill('editable'); await input.press('Shift+Enter');
      await expect(input).toHaveValue('editable\n');
      await input.press('ControlOrMeta+A'); await input.press('Backspace');
      await expect(input).toHaveValue('');
      await info.attach(label, { body: await page.screenshot(), contentType: 'image/png' });
    }
    const settings = appTrigger(page, 'settings');
    await settings.focus(); await expect(settings).toHaveCSS('outline-style', 'solid');
  });
  test('composer attachments stage repeated drop/paste edits without reference mutations', async ({ page }, info) => {
    await ready(page);
    await expect(page.locator('.generated-images')).not.toHaveAttribute('open');
    await expect(page.locator('.attachments, .composer-actions')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toHaveCount(0);
    await drop(page, ['/fixture/image.png']);
    await drop(page, ['/fixture/folder']);
    await paste(page);
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    await expect(page.locator('.attachment-chip img')).toBeVisible();
    await expect(page.getByRole('button', { name: /Move attachment/ })).toHaveCount(0);
    await expect(page.locator('.attachment-open > span')).toHaveText(['image.png', 'folder', 'Clipboard image 3']);
    await expect(page.locator('.attachment-chip [role=status]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove attachment /fixture/image.png', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.attachment-chip')).toHaveCount(2);
    await page.locator('.attachment-composer').evaluate(element => {
      const r = element.getBoundingClientRect(); const position = { x: (r.x + 20) * devicePixelRatio, y: (r.y + 20) * devicePixelRatio };
      window.__nativeFixture.nativeEvent('tauri://drag-enter', { paths: ['/drop/folder'], position });
    });
    await expect(page.locator('.attachment-drop-active')).toBeVisible();
    await page.evaluate(() => window.__nativeFixture.nativeEvent('tauri://drag-over', { position: { x: -1, y: -1 } }));
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await page.locator('.attachment-composer').evaluate(element => {
      const r = element.getBoundingClientRect();
      window.__nativeFixture.nativeEvent('tauri://drag-over', {
        position: { x: (r.x + 20) * devicePixelRatio, y: (r.y + 20) * devicePixelRatio } });
    });
    await expect(page.locator('.attachment-drop-active')).toBeVisible();
    await page.evaluate(() => window.__nativeFixture.nativeEvent('tauri://drag-leave', {}));
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await page.locator('.attachment-composer').evaluate(element => {
      const r = element.getBoundingClientRect();
      window.__nativeFixture.nativeEvent('tauri://drag-enter', { paths: ['/drop/folder'],
        position: { x: (r.x + 20) * devicePixelRatio, y: (r.y + 20) * devicePixelRatio } });
    });
    await expect(page.locator('.attachment-drop-active')).toBeVisible();
    await info.attach('highlighted-composer', { body: await page.screenshot(), contentType: 'image/png' });
    await drop(page, ['/drop/folder']);
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await page.evaluate(() => window.__nativeFixture.drop(['/outside']));
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    expect(await requests(page)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.staged)).toEqual([]);
    await expect(page.locator('.runner-references')).toHaveCount(0);
  });
  test('composer attachments submit only remaining paths and frozen paste bytes to exact Runner', async ({ page }) => {
    await ready(page);
    await drop(page, ['/fixture/image.png']);
    await paste(page);
    await drop(page, ['/fixture/folder']);
    await actions(page).attachments.remove('runner', 0);
    await page.evaluate(() => window.__nativeFixture.missingImage(true));
    await page.evaluate(() => {
      const decode = window.createImageBitmap.bind(window);
      window.__submissionBitmapReads = 0;
      window.createImageBitmap = (...args) => { window.__submissionBitmapReads++; return decode(...args); };
    });
    await send(page);
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ started_event_id: expect.any(Number), work_id: expect.any(Object) })]));
    const result = await page.evaluate(() => ({ staged: window.__nativeFixture.staged, reads: window.__nativeFixture.clipboardReads,
      bitmapReads: window.__submissionBitmapReads,
      refs: window.__nativeFixture.referenceRequests.filter(r => r.request.operation === 'references.register'),
      deliveries: window.__nativeFixture.deliveredSets }));
    expect(result.staged[0].png).toEqual(png); expect(result.reads).toEqual([]);
    expect(result.bitmapReads).toBe(0);
    expect(result.refs.map(r => [r.id, r.request.path])).toEqual([['pty-1', result.staged[0].path], ['pty-1', '/fixture/folder']]);
    expect(result.deliveries).toHaveLength(1); expect(result.deliveries[0].ids).toHaveLength(2);
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
  });
  test('composer attachments Single Entry retains preallocation selection independent of Runner tab', async ({ page }) => {
    await ready(page);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.dragListeners().length)).toBe(4);
    const previousListeners = await page.evaluate(() => window.__nativeFixture.dragListeners());
    await drop(page, ['/fixture/folder']);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.dragListeners().length)).toBe(4);
    expect(await page.evaluate(ids => window.__nativeFixture.dragListeners().filter(id => ids.includes(id)), previousListeners)).toEqual(previousListeners);
    await drop(page, ['/fixture/image.png']); await paste(page, 'single-entry');
    expect(await requests(page)).toEqual([]);
    const hub = actions(page);
    await hub.draft('single-entry', 'allocate attachments once');
    await hub.submit('single-entry');
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()]
      .some(session => session.feature.work?.started_event_id > 0))).toBe(true);
    const sent = await requests(page);
    expect(sent.filter(r => r.request.operation === 'references.register').map(r => r.id)).toEqual(['pty-2', 'pty-2']);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    await expect(page.locator('.attachment-open > span')).toHaveText('folder');
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
  });
  for (const fault of ['admissionFailure', 'unknownAdmission', 'staging', 'unsupported']) {
    test('composer attachments retain selection and block work on ' + fault, async ({ page }) => {
      await ready(page, { [fault]: true });
      if (fault === 'staging' || fault === 'unsupported') {
        await paste(page);
        await page.evaluate(fault => { const f = window.__nativeFixture;
          if (fault === 'staging') f.stageFailure(true); else f.sessions.get('pty-1').control.clipboardStaging = false;
        }, fault);
        await page.waitForTimeout(650);
      } else await drop(page, ['/fixture/image.png']);
      await send(page, 'retain original draft');
      await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
      await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('retain original draft');
      await expect(page.locator('.attachment-chip')).toHaveCount(1);
      expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
      const before = await requests(page);
      if (fault === 'unknownAdmission') { await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).press('Enter'); expect(await requests(page)).toEqual(before); }
    });
  }
  test('composer attachments partial rejection retains receipts, reconciles exact IDs and never duplicates work', async ({ page }) => {
    await ready(page, { auto: false, removal: true });
    await drop(page, ['/fixture/image.png']);
    await drop(page, ['/fixture/folder']); await send(page);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.register'); f.finishReference(r.id, r.requestId); });
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.filter(r => r.request.operation === 'references.register')[1]; f.finishReference(r.id, r.requestId, 'rejected'); });
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
    await page.locator('.attachment-chip').first().getByRole('button', { name: 'Reconcile registration', exact: true }).click();
    await expect.poll(async () => (await requests(page)).filter(r => r.request.operation === 'references.remove').length).toBe(1);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.remove'); f.finishReference(r.id, r.requestId); });
    await expect(page.locator('.attachment-chip').first().locator('[role=status]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
  });
  test('composer attachments inventory mismatch blocks work and keeps final selections', async ({ page }) => {
    await ready(page); await drop(page, ['/fixture/image.png']);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').changeInventoryAt = 2; });
    await send(page); await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
  });
  test('composer attachments keyboard paste preserves text and captures image before clipboard changes', async ({ page, context }) => {
    await ready(page); await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const input = page.getByRole('textbox', { name: 'Runner instructions', exact: true });
    await page.evaluate(() => navigator.clipboard.writeText('ordinary pasted text'));
    await input.focus(); await page.keyboard.press('Control+v'); await expect(input).toHaveValue('ordinary pasted text');
    await page.evaluate(bytes => navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]), png);
    await input.focus(); await page.keyboard.press('Control+v');
    await expect(page.locator('.attachment-chip img')).toBeVisible();
    await page.evaluate(() => navigator.clipboard.writeText('clipboard changed'));
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).press('Enter');
    await expect.poll(() => page.evaluate(() => [...window.__nativeFixture.sessions.values()].map(s => s.feature.work).filter(Boolean)), { timeout: 35000 }).toEqual(expect.arrayContaining([expect.objectContaining({ started_event_id: expect.any(Number), work_id: expect.any(Object) })]));
    expect(await page.evaluate(() => window.__nativeFixture.staged.length)).toBe(1);
  });
}
