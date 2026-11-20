import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';

test('outside gesture survives rerender and invokes only the replacement callback', async ({ page }, testInfo) => {
  await page.goto('/tests/fixtures/dialog-backdrop.html');
  const dialog = page.locator('dialog[aria-label="Callback fixture"]');
  const calls = page.getByLabel('Dismissal calls');
  await expect(dialog).toHaveAttribute('data-callback-ready', 'original');
  await expect(calls).toHaveText('[]');
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThan(0);
  await page.mouse.move(bounds.x / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await dialog.getByRole('button', { name: 'Replace callback' }).evaluate(button => button.click());
  await expect(dialog).toHaveAttribute('data-callback-ready', 'replacement');
  await expect(dialog).toBeVisible();
  await expect(calls).toHaveText('[]');
  await page.mouse.up();
  await expect(dialog).not.toBeVisible();
  await expect(calls).toHaveText('["replacement"]');
  await testInfo.attach('callback-observation', {
    body: JSON.stringify({ callbackBeforePress: 'original', callbackBeforeRelease: 'replacement',
      calls: JSON.parse(await calls.textContent()), dialogOpen: await dialog.evaluate(node => node.open) }),
    contentType: 'application/json',
  });
});
