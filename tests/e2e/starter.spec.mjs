import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test.use({ navigationTimeout: 60_000 });
test.setTimeout(90_000);

test('ordinary browser startup requires installation setup', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const response = await page.goto('/');
  expect(response?.ok(), 'The owned checkout must respond successfully').toBeTruthy();
  await expect(page).toHaveTitle('AgentRunnerHub');
  await expect(page.locator('script[type="module"][src="/src/hub/entry.tsx"]')).toHaveCount(1);
  await expect(page.locator('#counter')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Web App', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect your AgentRunner', exact: true })).toBeVisible();
  await expect(page.locator('.runner-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verify and Start' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'AgentRunner location' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await testInfo.attach('empty-light-1000x700', { body: await page.screenshot(), contentType: 'image/png' });
});
