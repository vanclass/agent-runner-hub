import { PNG } from 'pngjs';
import { imageBackdrop, registerOrdinaryBackdrops } from './dialog-backdrops.mjs';
const png = [...PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640 * 320 * 4, 180) })];
const original = '  첫 번째 줄\n# 원문 <script>window.previewExecuted=true</script>\n{"값": "한글"}\n  ';

export async function imageGestures(page, expect, width = 640) {
  const viewport = page.locator('.focused-image-viewport'), image = viewport.locator('img');
  await expect(image).toHaveJSProperty('naturalWidth', width);
  const source = await image.getAttribute('src'), initial = await image.boundingBox();
  const host = await viewport.boundingBox();
  await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
  await page.mouse.wheel(0, -350);
  await expect.poll(async () => (await image.boundingBox()).width).toBeGreaterThan(initial.width);
  const zoomed = await image.boundingBox();
  expect(zoomed.width / zoomed.height).toBeCloseTo(2, 2);
  await page.mouse.down(); await page.mouse.move(host.x + host.width / 2 + 60, host.y + host.height / 2 + 35); await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox()).x).toBeGreaterThan(zoomed.x + 40);
  await page.mouse.wheel(0, 350);
  await expect.poll(async () => (await image.boundingBox()).width).toBeLessThan(zoomed.width);
  expect(await image.getAttribute('src')).toBe(source);
  await page.keyboard.press('Escape'); await expect(page.locator('.focused-viewer[open]')).toHaveCount(0);
}

export function registerPreviewViews({ test, expect, ready, drop }) {
  registerOrdinaryBackdrops({ test, expect, ready });
  for (const entry of [false, true]) {
    async function setup(page) {
      await ready(page);
      await page.evaluate(({ png, original }) => {
        const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
        native.invoke = async (command, args) => {
          if (command !== 'local_file_preview') return invoke(command, args);
          if (args.path.endsWith('.png')) return { kind: 'image', path: args.path, base64: btoa(String.fromCharCode(...png)) };
          if (/\.(txt|md|json)$/.test(args.path) && !args.path.includes('missing')) return { kind: 'text', path: args.path, text: original };
          return { kind: 'unavailable', path: args.path, reason: 'unsupported' };
        };
      }, { png, original });
      if (entry) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
    }
    const label = entry ? 'Single Entry' : 'Runner';
    test('dialog backdrop attachment ' + label + ' protects gestures and returns focus', async ({ page }) => {
      await setup(page); await drop(page, ['/fixture/backdrop.png']);
      const opener = page.getByRole('button', { name: 'Open attachment backdrop.png', exact: true });
      await opener.click();
      await expect(page.locator('.focused-image-viewport img')).toHaveJSProperty('naturalWidth', 640);
      await imageBackdrop(page, expect, opener);
    });
    test('focused preview ' + label + ' local image header, rendered gestures and reset', async ({ page }, info) => {
      await setup(page); await drop(page, ['/fixture/first.png','/fixture/second.png']);
      const open = page.getByRole('button', { name: 'Open attachment first.png', exact: true });
      await open.locator('img').click();
      await expect(page.getByRole('dialog', { name: 'first.png', exact: true })).toBeVisible();
      await expect(page.locator('.focused-viewer header')).toHaveText('first.png');
      await expect(page.locator('.focused-viewer[open] button')).toHaveCount(0);
      const bounds = await page.locator('.focused-viewer[open]').boundingBox();
      expect(bounds.width).toBeGreaterThan(640);
      expect(bounds.x).toBeGreaterThan(0);
      await info.attach('local-contained-focus', { body: await page.screenshot(), contentType: 'image/png' });
      await imageGestures(page, expect);
      await expect(open).toBeFocused();
      await open.click(); await expect(page.locator('.focused-image-viewport')).toHaveAttribute('data-scale','1');
      await expect(page.locator('.focused-image-viewport')).toHaveAttribute('data-x','0');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Open attachment second.png', exact: true }).click();
      await expect(page.locator('.focused-image-viewport')).toHaveAttribute('data-scale','1');
      await expect(page.locator('.focused-viewer header')).toHaveText('second.png');
    });
    test('focused preview ' + label + ' exact original txt md json and retained failures', async ({ page }) => {
      await setup(page);
      const paths = ['original.txt','original.md','original.json','missing.txt','unsupported.pdf','folder'];
      await drop(page, paths.map(name => '/fixture/' + name));
      for (const name of paths) {
        await page.getByRole('button', { name: 'Open attachment ' + name, exact: true }).click();
        await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
        if (name.startsWith('original')) {
          await expect(page.locator('.focused-text')).toHaveJSProperty('textContent', original);
          expect(await page.evaluate(() => window.previewExecuted)).toBeUndefined();
        } else await expect(page.locator('.focused-viewer[open] [role=status]')).toContainText('cannot be previewed');
        await page.keyboard.press('Escape');
        await expect(page.locator('.attachment-chip')).toHaveCount(paths.length);
      }
    });
  }
  test('preview Help follows App Settings and shares truthful catalog domains', async ({ page }, info) => {
    await ready(page);
    const settings = page.locator('.hub-preferences > button').first(), help = page.getByRole('button', { name: 'Help', exact: true });
    const left = await settings.boundingBox(), right = await help.boundingBox();
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
    expect(Math.abs(right.y-left.y)).toBeLessThan(4);
    await help.click();
    const dialog = page.getByRole('dialog', { name: 'Help', exact: true }); await expect(dialog).toBeVisible();
    await expect(dialog.locator('dt')).toHaveText(['Images','Text','Mixed / other']);
    const formats = await page.evaluate(async () => (await import('/src/hub/localPreviews.ts')).previewExtensions);
    await expect(dialog.locator('dd').nth(0)).toHaveText(formats.image.map(x=>'.'+x).join(', '));
    await expect(dialog.locator('dd').nth(1)).toHaveText(formats.text.map(x=>'.'+x).join(', '));
    await expect(dialog.locator('dd').nth(2)).toContainText('no local content preview');
    await info.attach('catalog-help', { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(help).toBeFocused();
  });
}
