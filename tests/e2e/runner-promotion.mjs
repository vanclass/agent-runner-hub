export function registerRunnerPromotion({ test, expect, transport, configure, create, generatedFixture }) {
  test('promotion completed work and images give way to new tab results', async ({ page }) => {
    await transport(page, undefined, { auto: true, work: true, ...generatedFixture() });
    await configure(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'issue-run' });
    await create(page);
    await page.locator('.generated-images summary').click();
    await expect(page.locator('.generated-image-preview img')).toBeVisible();
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('old tab work');
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await expect(page.locator('.runner-work-status')).toContainText('Verified start event', { timeout: 35000 });
    await expect(page.locator('.config-receipt')).not.toHaveCount(0);
    await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    await page.evaluate(() => { window.__nativeFixture.sessions.get('pty-1').feature.mode = 'succeeded'; });
    await expect(page.locator('.unread-completion')).toBeVisible();
    const old = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0]);
    await page.locator('.runner-row .remove-action').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Terminate and close tab', exact: true }).click();
    await page.waitForTimeout(2000); await create(page);
    const next = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-runner-hub.workspace.v1')).tabs[0]);
    expect(next.id).not.toBe(old.id); expect(next.createdOrder).toBeGreaterThan(old.createdOrder);
    await expect(page.locator('.runner-work-status, .config-receipt, .unread-completion, .status-dot.completed')).toHaveCount(0);
    await page.locator('.generated-images summary').click();
    await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.locator('.generated-images')).toContainText('ownership by this new tab could not be verified');
    await expect(page.locator('.generated-image-preview')).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.closed)).toEqual([]);
    await page.evaluate(() => {
      const n = window.__nativeFixture.sessions.get('pty-1'); n.feature.mode = 'started';
      n.images.push({ ...n.images[0], imageId: 'f'.repeat(32), sourceSequence: 3 });
    });
    await expect(page.getByRole('button', { name: 'Refresh images', exact: true })).toBeDisabled();
    await expect(page.locator('.generated-image-preview')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).focus();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption({ label: 'task-run' });
    await page.getByRole('textbox', { name: 'Runner instructions', exact: true }).fill('new tab work');
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await expect(page.locator('.runner-work-status')).toContainText('Verified start event', { timeout: 35000 });
    await expect(page.locator('.config-receipt')).not.toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeFixture.sessions.get('pty-1').feature.requests.filter(r => r.operation === 'work.submit').length)).toBe(2);
  });
  for (const delayed of ['list', 'read', 'failure', 'unavailable']) {
    test(`promotion retains authority and fences old image ${delayed}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true, workDiscovery: true, ...generatedFixture() }); await page.goto('/');
      await page.evaluate(async delayed => {
        const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
        const owner = window.__promotionOwner = new RunnerSessions(), created = owner.create('/fixture/install');
        await created.launched; const s = window.__promoted = created.session; await s.control.fresh();
        const f = window.__nativeFixture.sessions.get('pty-1').feature;
        f.mode = 'succeeded'; await s.control.work.submit('retained original');
        const c = s.control.config; await c.inspect(); c.setDraft({ run_mode: 'issue-run' }); await c.createPlan(); await c.apply();
        window.__oldAttempt = s.control.work.current; window.__oldApplication = c.latestApplication;
        s.closeFailure(new Error('previous tab alert')); c.error = 'previous configuration alert';
        if (delayed === 'unavailable') {
          window.__nativeFixture.sessions.get('pty-1').imageFailure = { state: 'unavailable' };
          window.__releaseOldImage = () => {}; return;
        }
        const n = window.__TAURI_INTERNALS__, invoke = n.invoke; let held = false;
        n.invoke = async (command, args) => {
          if (!held && command === (delayed === 'list' ? 'runner_images_list' : 'runner_image_read')) {
            held = true; const result = await invoke(command, args);
            await new Promise(resolve => { window.__releaseOldImage = resolve; });
            if (delayed === 'failure') throw new Error('old image failure'); return result;
          }
          return invoke(command, args);
        };
        s.control.images.mount();
      }, delayed);
      await expect.poll(() => page.evaluate(() => !!window.__releaseOldImage)).toBe(true);
      await page.evaluate(() => window.__promotionOwner.close(window.__promoted.view.id));
      await expect.poll(() => page.evaluate(() => window.__promoted.reusableIdle)).toBe(true);
      await page.evaluate(() => {
        const s = window.__promoted;
        if (window.__promotionOwner.allocate('/fixture/install').session !== s) throw new Error('wrong session');
        window.__releaseOldImage();
      });
      await expect.poll(() => page.evaluate(() => window.__promoted.control.images.state)).toBe('unavailable');
      expect(await page.evaluate(() => {
        const s = window.__promoted, w = s.control.work, c = s.control.config;
        return { attempt: w.current === window.__oldAttempt, application: c.latestApplication === window.__oldApplication,
          current: !!w.presentedCurrent, activity: s.tabView.activity, unread: w.unread,
          receipts: c.presentedApplications.length, preview: !!s.control.images.preview,
          alert: s.view.detail, configAlert: c.presentedError, retainedAlert: c.error };
      })).toEqual({ attempt: true, application: true, current: false, activity: 'idle', unread: false, receipts: 0, preview: false,
        alert: undefined, configAlert: '', retainedAlert: 'previous configuration alert' });
      await page.evaluate(async () => {
        const n = window.__nativeFixture.sessions.get('pty-1'); n.imageFailure = undefined;
        n.images.push({ ...n.images[0], imageId: 'f'.repeat(32) }); await window.__promoted.control.images.refresh(true);
      });
      expect(await page.evaluate(() => JSON.stringify(window.__promoted.control.images.detail))).toContain('scopeUnavailable');
      expect(await page.evaluate(() => window.__promoted.control.images.items.length)).toBe(0);
      await page.evaluate(async () => {
        const created = window.__promotionOwner.create('/fixture/install'); await created.launched;
        const images = window.__freshImages = created.session.control.images;
        await created.session.control.fresh(); images.mount();
      });
      await expect.poll(() => page.evaluate(() => !!window.__freshImages.preview)).toBe(true);
      await page.evaluate(() => window.__promotionOwner.dispose());
    });
  }
}
