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
    const opener = page.getByRole('button', { name: 'App settings', exact: true });
    await opener.click();
    const dialog = page.locator('.app-settings[open]'), frame = await dialog.boundingBox();
    await page.mouse.move(frame.x / 2, frame.y + frame.height / 2);
    await page.mouse.down();
    await dialog.getByRole('button', { name: 'Black', exact: true }).evaluate(button => button.click());
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
    await page.mouse.up();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
  test('dialog backdrop ordinary settings and Help preserve interior and close paths', async ({ page }) => {
    await ready(page);
    for (const [trigger, selector] of [['App settings', '.app-settings[open]'], ['Help', '.preview-help[open]']]) {
      const opener = page.getByRole('button', { name: trigger, exact: true });
      for (const close of ['backdrop', 'Escape', 'button']) {
        await opener.click(); const dialog = page.locator(selector);
        const r = await dialog.boundingBox();
        await page.mouse.click(r.x + 3, r.y + 3); await expect(dialog).toBeVisible();
        if (close === 'backdrop') await page.mouse.click(r.x / 2, r.y);
        else if (close === 'Escape') await page.keyboard.press('Escape');
        else if (trigger === 'App settings') await dialog.locator('.settings-close').click();
        else await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
      }
    }
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.locator('.shortcut-settings-trigger').click();
    const shortcuts = page.locator('.shortcut-settings[open]');
    await shortcuts.getByRole('button', { name: 'Assign instruction', exact: true }).click();
    await page.mouse.click(5, 5); await expect(shortcuts).toBeVisible();
    await expect(shortcuts.locator('[aria-pressed=true]')).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(shortcuts).toBeVisible();
    await expect(shortcuts.locator('[aria-pressed=true]')).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(shortcuts).toHaveCount(0);
  });
}
