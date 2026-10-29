export function registerAttachmentOutcomes({ test, expect, ready, paste, requests, send }) {
  test('attachment outcomes other pending references require explicit review of complete inventory', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').items = [1, 2, 3].map(n => ({
      reference_id: n.toString(16).padStart(32, 'a'), display_index: n, display_name: 'terminal-' + n,
      kind: 'file', media_kind: null, image_detail: null })); });
    await page.getByRole('button', { name: 'Attach file', exact: true }).click(); await send(page);
    await expect(page.getByRole('button', { name: 'Include other pending references', exact: true })).toBeEnabled();
    expect(await requests(page)).toEqual([]);
    await page.getByRole('button', { name: 'Include other pending references', exact: true }).click();
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await expect(page.getByLabel('Runner work', { exact: true })).toContainText('Verified start event');
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets[0].ids.length)).toBe(4);
  });
  test('attachment outcomes Single Entry unknown admission cannot release or rebind its selection', async ({ page }) => {
    await ready(page, { unknownAdmission: true });
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'task-run' });
    await paste(page, 'Single Entry instructions');
    await page.getByRole('textbox', { name: 'Single Entry instructions', exact: true }).fill('retain exact destination');
    await page.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Release unsent assignment', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Release unsent assignment', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Assign instruction', exact: true })).toBeDisabled();
    await expect(page.locator('.attachment-chip')).toHaveCount(1);
    expect((await requests(page)).map(r => r.id)).toEqual(['pty-2']);
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
  });
  test('attachment outcomes late registration stays on original session and is never replayed', async ({ page }) => {
    await ready(page, { auto: false }); await paste(page); await send(page);
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.register'); f.finishReference(r.id, r.requestId, 'outcome-unknown'); });
    await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    expect(await requests(page)).toHaveLength(1);
    await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.register'); f.finishReference(r.id, r.requestId); });
    await expect(page.locator('.attachment-chip')).toHaveCount(0);
    await page.locator('.runner-row').first().locator('.nav-row').click();
    await expect(page.locator('.attachment-chip')).toContainText('Registered');
    expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
    expect((await requests(page)).map(r => r.id)).toEqual(['pty-1']);
  });
  for (const entry of [false, true]) {
    test('attachment outcomes late work start clears only originating ' + (entry ? 'Single Entry' : 'Runner') + ' selections', async ({ page }) => {
      await ready(page, { workMode: 'unknown' });
      if (entry) {
        await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
        await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'task-run' });
      }
      await paste(page, entry ? 'Single Entry instructions' : 'Runner instructions');
      const input = page.getByRole('textbox', { name: entry ? 'Single Entry instructions' : 'Runner instructions', exact: true });
      await input.fill('one uncertain instruction');
      await page.getByRole('button', { name: entry ? 'Assign instruction' : 'Send instruction', exact: true }).click();
      if (entry) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      await expect(input).toHaveValue('one uncertain instruction');
      const id = entry ? 'pty-2' : 'pty-1';
      await expect.poll(() => page.evaluate(id => window.__nativeFixture.deliveredSets.filter(d => d.id === id).length, id)).toBe(1);
      await expect(page.locator('.attachment-chip')).toHaveCount(1);
      await page.evaluate(id => { window.__nativeFixture.sessions.get(id).feature.mode = 'started'; }, id);
      await expect(input).toHaveValue(''); await expect(page.locator('.attachment-chip')).toHaveCount(0);
      expect(await page.evaluate(id => window.__nativeFixture.deliveredSets.filter(d => d.id === id).length, id)).toBe(1);
    });
  }
  for (const mode of ['unknown', 'unsupported']) {
    test('attachment outcomes ' + mode + ' removal retains original IDs and blocks unsafe replay', async ({ page }) => {
      await ready(page, { auto: false, legacyRemoval: mode === 'unsupported' });
      await page.getByRole('button', { name: 'Attach file', exact: true }).click();
      await page.getByRole('button', { name: 'Attach folder', exact: true }).click(); await send(page);
      await expect.poll(async () => (await requests(page)).length).toBe(1);
      await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.register'); f.finishReference(r.id, r.requestId); });
      await expect.poll(async () => (await requests(page)).length).toBe(2);
      await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.filter(r => r.request.operation === 'references.register')[1]; f.finishReference(r.id, r.requestId, 'rejected'); });
      await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
      await page.locator('.attachment-chip').first().getByRole('button', { name: 'Reconcile registration', exact: true }).click();
      if (mode === 'unknown') {
        await expect.poll(async () => (await requests(page)).filter(r => r.request.operation === 'references.remove').length).toBe(1);
        await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.remove'); f.finishReference(r.id, r.requestId, 'outcome-unknown'); });
      }
      await expect(page.locator('.attachment-chip').first()).toContainText('Outcome unknown');
      await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
      expect(await page.evaluate(() => window.__nativeFixture.deliveredSets)).toEqual([]);
      expect((await requests(page)).filter(r => r.request.operation === 'references.remove')).toHaveLength(mode === 'unknown' ? 1 : 0);
      if (mode === 'unknown') {
        await page.evaluate(() => { const f = window.__nativeFixture, r = f.referenceRequests.find(r => r.request.operation === 'references.remove'); f.finishReference(r.id, r.requestId); });
        await expect(page.locator('.attachment-chip').first()).toContainText('Removed');
        await page.locator('.attachment-chip').first().getByRole('button', { name: 'Reconcile registration', exact: true }).click();
        await expect(page.locator('.attachment-chip').first()).toContainText('Staged');
      }
    });
  }
  test('attachment outcomes staging failure precedes all path registrations', async ({ page }) => {
    await ready(page); await page.getByRole('button', { name: 'Attach file', exact: true }).click(); await paste(page);
    await page.evaluate(() => window.__nativeFixture.stageFailure(true)); await send(page);
    await expect(page.getByRole('button', { name: 'Send instruction', exact: true })).toBeEnabled();
    expect(await requests(page)).toEqual([]); await expect(page.locator('.attachment-chip')).toHaveCount(2);
  });
}
