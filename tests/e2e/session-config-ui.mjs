export function registerSessionConfigUI({ test, expect, transport, configure }) {
  async function open(page, count = 1) {
    await transport(page);
    await configure(page);
    for (let i = 0; i < count; i++) await page.getByRole('button', { name: 'New Runner', exact: true }).click();
    await page.evaluate(async () => (await import('/tests/fixtures/sessionConfig.ts')).attachConfigToHub());
    await page.getByText('Runner configuration', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Inspect settings and options', exact: true })).toBeEnabled();
  }
  test('session config UI selects actual identities, reviews a plan and explicitly applies without PTY submission', async ({ page }, testInfo) => {
    await open(page);
    await page.getByRole('button', { name: 'Inspect settings and options', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Draft Account', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Draft Account', exact: true }).selectOption('["codex","second"]');
    await expect(page.getByRole('combobox', { name: 'Draft Model', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Draft Model', exact: true }).selectOption('s0');
    await page.getByRole('combobox', { name: 'Draft Reasoning effort', exact: true }).selectOption('high');
    await page.getByRole('combobox', { name: 'Draft Service tier', exact: true }).selectOption('fast');
    await page.getByRole('combobox', { name: 'Draft Project / Target', exact: true }).selectOption('project:Exact');
    await page.getByRole('combobox', { name: 'Draft Run Mode', exact: true }).selectOption('direct-run');
    await page.getByRole('textbox', { name: 'Draft Direct / Pure Direct Root', exact: true }).fill('C:/explicit root');
    await page.getByRole('button', { name: 'Plan changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply reviewed plan', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__configFixtures.get('pty-2').requests.filter(r => r.operation.endsWith('.apply')))).toEqual([]);
    await testInfo.attach('configuration-reviewed-plan-light', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ko');
    await page.getByRole('button', { name: '블랙', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '설정 초안: Direct / Pure Direct 작업 경로', exact: true })).toHaveValue('C:/explicit root');
    await expect(page.getByRole('button', { name: '검토한 계획 적용', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '검토한 계획 적용', exact: true }).click();
    await expect(page.locator('.config-receipt')).toContainText('Runner가 설정 적용을 확인했습니다.');
    await expect(page.locator('.config-receipt')).toContainText('최종 Runner 상태를 조회했습니다.');
    await expect(page.locator('.config-current')).toContainText('second');
    await expect(page.locator('.config-current')).toContainText('C:/explicit root');
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
    expect(await page.evaluate(() => window.__nativeFixture.commands)).toEqual([]);
    await testInfo.attach('configuration-receipts-korean-black', { body: await page.screenshot(), contentType: 'image/png' });
    const composer = page.getByRole('textbox', { name: 'Runner 지시문', exact: true });
    await composer.scrollIntoViewIfNeeded();
    const box = await composer.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  });

  test('session config UI keeps requests on the original tab and fences an exited Runner’s late apply', async ({ page }) => {
    await open(page, 2);
    const firstRow = page.locator('.runner-row').nth(0), secondRow = page.locator('.runner-row').nth(1);
    await firstRow.locator('.nav-row').click();
    await page.getByText('Runner configuration', { exact: true }).click();
    await page.getByRole('button', { name: 'Inspect settings and options', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Draft Run Mode', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Draft Run Mode', exact: true }).selectOption('issue-run');
    await page.evaluate(() => { window.__configFixtures.get('pty-2').hold = true; });
    await page.getByRole('button', { name: 'Plan changes', exact: true }).click();
    await expect(page.locator('.config-progress')).toContainText('Queued by Runner');
    await secondRow.locator('.nav-row').click();
    await page.getByText('Runner configuration', { exact: true }).click();
    await page.getByRole('button', { name: 'Inspect settings and options', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Draft Run Mode', exact: true })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Draft Run Mode', exact: true })).toHaveValue('task-run');
    await page.evaluate(() => { const fixture = window.__configFixtures.get('pty-2'); fixture.hold = false; fixture.complete(); });
    await firstRow.locator('.nav-row').click();
    await page.getByText('Runner configuration', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply reviewed plan', exact: true })).toBeEnabled();
    await page.evaluate(() => { window.__configFixtures.get('pty-2').holdOperation = 'session_config.apply'; });
    await page.getByRole('button', { name: 'Apply reviewed plan', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__configFixtures.get('pty-2').requests.some(r => r.operation.endsWith('.apply')))).toBe(true);
    await page.evaluate(() => { const native = window.__nativeFixture; native.exit('pty-2', 0, native.sessions.get('pty-2').control); });
    await expect(page.locator('.config-receipt')).toContainText('Completion is unconfirmed.');
    await page.evaluate(() => window.__configFixtures.get('pty-2').complete());
    await expect(page.locator('.config-receipt')).toContainText('Completion is unconfirmed.');
    await secondRow.locator('.nav-row').click();
    await page.getByText('Runner configuration', { exact: true }).click();
    await expect(page.locator('.config-current')).toContainText('task-run');
    expect(await page.evaluate(() => window.__configFixtures.get('pty-3').requests.some(r => r.operation.endsWith('.apply')))).toBe(false);
  });

  test('session config UI retains a partial commit when the final inspection fails', async ({ page }, testInfo) => {
    await open(page);
    await page.getByRole('button', { name: 'Inspect settings and options', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Draft Model', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Draft Model', exact: true }).selectOption('m2');
    await page.getByRole('combobox', { name: 'Draft Service tier', exact: true }).selectOption('fast');
    await page.getByRole('combobox', { name: 'Draft Project / Target', exact: true }).selectOption('project:Exact');
    await page.getByRole('button', { name: 'Plan changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply reviewed plan', exact: true })).toBeEnabled();
    await page.evaluate(() => { const fixture = window.__configFixtures.get('pty-2'); fixture.applyOutcome = 'partial'; fixture.postApplyFailure = true; });
    await page.getByRole('button', { name: 'Apply reviewed plan', exact: true }).click();
    await expect(page.locator('.config-receipt')).toContainText('Some settings committed.');
    await expect(page.locator('.config-receipt')).toContainText('Owner-confirmed commit');
    await expect(page.locator('.config-receipt')).toContainText('Not attempted');
    await expect(page.locator('.config-receipt')).toContainText('final Runner inspection unavailable.');
    await testInfo.attach('configuration-partial-final-inspect-failure', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
