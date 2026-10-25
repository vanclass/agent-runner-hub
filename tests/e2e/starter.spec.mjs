import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';

test.use({ navigationTimeout: 60_000 });
test.setTimeout(90_000);

test('ordinary startup is an empty, disconnected Hub', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const response = await page.goto('/');
  expect(response?.ok(), 'The owned checkout must respond successfully').toBeTruthy();
  await expect(page).toHaveTitle('AgentRunnerHub');
  await expect(page.getByRole('heading', { name: 'Single Entry', exact: true })).toBeVisible();
  await expect(page.locator('.runner-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Single Entry', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Assign instruction' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Single Entry instructions' })).toBeEnabled();
  await expect(page.getByText('Attachments unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByText('Existing settings change only through their Runner.', { exact: false })).toBeVisible();
  await testInfo.attach('empty-light-1000x700', { body: await page.screenshot(), contentType: 'image/png' });
});
