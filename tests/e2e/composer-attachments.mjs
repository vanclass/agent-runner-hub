import { PNG } from 'pngjs';
import { registerAttachmentOutcomes } from './attachment-outcomes.mjs';
const png = [...PNG.sync.write({ width: 1, height: 1, data: Buffer.from([31, 87, 201, 255]) })];
async function paste(page, label = 'Runner instructions') {
  await page.getByRole('textbox', { name: label, exact: true }).evaluate((input, bytes) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }));
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
}
async function requests(page) {
  return page.evaluate(() => window.__nativeFixture.referenceRequests.filter(r => r.request.operation !== 'references.list'));
}
export function registerComposerAttachments({ test, expect, transport, configure, create }) {
  expect = expect.configure({ timeout: 30000 });
  async function ready(page, options = {}) {
    await transport(page, undefined, { work: true, clipboard: true, auto: true, ...options });
    await configure(page); await create(page);
  }
  async function send(page, text = 'submit final attachments') {
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  }
  registerAttachmentOutcomes({ test, expect, ready, paste, requests, send });
  test('composer attachments stage repeated picker/drop/paste edits without reference mutations', async ({ page }, info) => {
    await ready(page);
    await expect(page.locator('.generated-images')).not.toHaveAttribute('open');
    await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await page.getByRole('button', { name: 'Attach folder', exact: true }).click();
    await paste(page);
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    await expect(page.locator('.attachment-chip img')).toBeVisible();
    await page.getByRole('button', { name: 'Move attachment /fixture/folder earlier', exact: true }).click();
    await expect(page.locator('.attachment-chip').first()).toContainText('/fixture/folder');
    await page.getByRole('button', { name: 'Remove attachment /fixture/image.png', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.attachment-chip')).toHaveCount(2);
    await page.locator('.attachment-composer').evaluate(element => {
      const r = element.getBoundingClientRect(); const position = { x: (r.x + 20) * devicePixelRatio, y: (r.y + 20) * devicePixelRatio };
      window.__nativeFixture.nativeEvent('tauri://drag-enter', { paths: ['/drop/folder'], position });
    });
    await expect(page.locator('.attachment-drop-active')).toBeVisible();
    await info.attach('highlighted-composer', { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('.attachment-composer').evaluate(element => {
      const r = element.getBoundingClientRect();
      window.__nativeFixture.nativeEvent('tauri://drag-drop', { paths: ['/drop/folder'], position: { x: r.x + 20, y: r.y + 20 } });
    });
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    await expect(page.locator('.attachment-drop-active')).toHaveCount(0);
    await page.evaluate(() => window.__nativeFixture.drop(['/outside']));
    await expect(page.locator('.attachment-chip')).toHaveCount(3);
    expect(await requests(page)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.staged)).toEqual([]);
    await expect(page.locator('.runner-references')).toHaveCount(0);
  });
  test('composer attachments submit only remaining ordered paths and frozen paste bytes to exact Runner', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await paste(page);
    await page.getByRole('button', { name: 'Attach folder', exact: true }).click();
    await page.getByRole('button', { name: 'Remove attachment /fixture/image.png', exact: true }).click();
    await page.getByRole('button', { name: 'Move attachment /fixture/folder earlier', exact: true }).click();
    await page.getByRole('button', { name: 'Move attachment /fixture/folder earlier', exact: true }).click();
    await page.evaluate(() => window.__nativeFixture.missingImage(true));
    await send(page);
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    const result = await page.evaluate(() => ({ staged: window.__nativeFixture.staged, reads: window.__nativeFixture.clipboardReads,
      refs: window.__nativeFixture.referenceRequests.filter(r => r.request.operation === 'references.register'),
      deliveries: window.__nativeFixture.deliveredSets }));
    expect(result.staged[0].png).toEqual(png); expect(result.reads).toEqual([]);
    expect(result.refs.map(r => [r.id, r.request.path])).toEqual([['pty-1', '/fixture/folder'], ['pty-1', result.staged[0].path]]);
    expect(result.deliveries).toHaveLength(1); expect(result.deliveries[0].ids).toHaveLength(2);
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('');
  });
  test('composer attachments Single Entry retains preallocation selection independent of Runner tab', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: 'Attach folder', exact: true }).click();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'task-run' });
    await page.getByRole('button', { name: 'Attach file', exact: true }).click(); await paste(page, 'Single Entry instructions');
    expect(await requests(page)).toEqual([]);
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('allocate attachments once');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.locator('.control-status')).toContainText('Runner verified start');
    const sent = await requests(page);
    expect(sent.filter(r => r.request.operation === 'references.register').map(r => r.id)).toEqual(['pty-2', 'pty-2']);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    await expect(page.locator('.attachment-chip')).toContainText('/fixture/folder');
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
      } else await page.getByRole('button', { name: 'Attach file', exact: true }).click();
      await send(page, 'retain original draft');
      await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
      await expect(page.getByRole('textbox', { name: 'Runner instructions', exact: true })).toHaveValue('retain original draft');
      await expect(page.locator('.attachment-chip')).toHaveCount(1);
      expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
      const before = await requests(page);
      if (fault === 'unknownAdmission') { await page.getByRole('button', { name: 'Send instruction', exact: true }).click(); expect(await requests(page)).toEqual(before); }
    });
  }
  test('composer attachments partial rejection retains receipts, reconciles exact IDs and never duplicates work', async ({ page }) => {
    await ready(page, { auto: false, removal: true });
    await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await page.getByRole('button', { name: 'Attach folder', exact: true }).click(); await send(page);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.register'); f.finishReference(r.id, r.requestId); });
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.filter(r => r.request.operation === 'references.register')[1]; f.finishReference(r.id, r.requestId, 'rejected'); });
    await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
    await page.locator('.attachment-chip').first().getByRole('button', { name: 'Reconcile registration', exact: true }).click();
    await expect.poll(async () => (await requests(page)).filter(r => r.request.operation === 'references.remove').length).toBe(1);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.remove'); f.finishReference(r.id, r.requestId); });
    await expect(page.locator('.attachment-chip').first()).toContainText('Staged');
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
  });
  test('composer attachments inventory mismatch blocks work and keeps final selections', async ({ page }) => {
    await ready(page); await page.getByRole('button', { name: 'Attach file', exact: true }).click();
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').changeInventoryAt = 2; });
    await send(page); await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
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
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    expect(await page.evaluate(() => window.__nativeFixture.staged.length)).toBe(1);
  });
}
