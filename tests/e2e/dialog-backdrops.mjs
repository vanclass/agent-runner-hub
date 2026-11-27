import { appTrigger, openAppEntry } from './application-menu.mjs';
export async function imageBackdrop(page, expect, opener) {
  const dialog = page.locator('.focused-viewer[open]');
  const viewport = dialog.locator('.focused-image-viewport');
  const frame = await dialog.boundingBox(), host = await viewport.boundingBox();
  const outside = { x: frame.x / 2, y: frame.y + frame.height / 2 };
  const inside = { x: host.x + host.width / 2, y: host.y + host.height / 2 };
  await page.mouse.click(inside.x, inside.y);
  await page.mouse.click(frame.x + 3, frame.y + 3); // Dialog padding targets the dialog too.
  await expect(dialog).toBeVisible();
  await page.mouse.move(inside.x, inside.y); await page.mouse.wheel(0, -200);
  await expect.poll(async () => Number(await viewport.getAttribute('data-scale'))).toBeGreaterThan(1);
  await page.mouse.down(); await page.mouse.move(outside.x, outside.y); await page.mouse.up();
  await expect(dialog).toBeVisible();
  expect(Number(await viewport.getAttribute('data-x'))).toBeLessThan(0);
  await page.mouse.move(outside.x, outside.y); await page.mouse.down();
  await page.mouse.move(frame.x + 3, frame.y + 3); await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(outside.x, outside.y, { button: 'right' });
  await expect(dialog).toBeVisible();
  for (const ending of ['pointercancel', 'lostpointercapture', 'mismatch', 'nonprimary']) {
    await dialog.evaluate((element, ending) => {
      const r = element.getBoundingClientRect(), base = { bubbles: true, pointerId: 81,
        isPrimary: ending !== 'nonprimary', button: 0, clientX: r.left / 2, clientY: r.top };
      element.dispatchEvent(new PointerEvent('pointerdown', base));
      if (['pointercancel', 'lostpointercapture'].includes(ending))
        element.dispatchEvent(new PointerEvent(ending, base));
      element.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: ending === 'mismatch' ? 82 : 81 }));
    }, ending);
    await expect(dialog).toBeVisible();
  }
  await page.mouse.click(outside.x, outside.y);
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
}

export function registerOrdinaryBackdrops({ test, expect, ready }) {
  test('dialog backdrop preserves an outside gesture across caller rerender', async ({ page }) => {
    await ready(page);
    const opener = appTrigger(page, 'runner');
    await openAppEntry(page, 'runner', 'installation');
    const dialog = page.locator('.installation-dialog[open]'), frame = await dialog.boundingBox();
    await page.mouse.move(frame.x / 2, frame.y + frame.height / 2);
    await page.mouse.down();
    await dialog.getByRole('textbox').evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '/rerender');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(dialog.getByRole('textbox')).toHaveValue('/rerender');
    await page.mouse.up();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
  test('dialog backdrop installation and guide preserve interior and close paths', async ({ page }) => {
    await ready(page);
    for (const [group, item, selector] of [['runner', 'installation', '.installation-dialog[open]'], ['help', 'preview', '.preview-help[open]']]) {
      const opener = appTrigger(page, group);
      for (const close of ['backdrop', 'Escape', 'button']) {
        await openAppEntry(page, group, item); const dialog = page.locator(selector);
        const r = await dialog.boundingBox();
        await page.mouse.click(r.x + 3, r.y + 3); await expect(dialog).toBeVisible();
        if (close === 'backdrop') await page.mouse.click(r.x / 2, r.y);
        else if (close === 'Escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
      }
    }
    await openAppEntry(page, 'settings', 'shortcuts');
    const shortcuts = page.locator('.shortcut-settings[open]');
    await shortcuts.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await page.mouse.click(5, 5); await expect(shortcuts).toBeVisible();
    await expect(shortcuts.locator('[aria-pressed=true]')).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(shortcuts).toBeVisible();
    await expect(shortcuts.locator('[aria-pressed=true]')).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(shortcuts).toHaveCount(0);
  });
}
