import { generatedSource, animatedFixture, injectGeneratedImage } from '../native/webdriver/attachment-preview.mjs';
import { watchObservations } from '../native/webdriver/runner-flow.mjs';
import { imageBackdrop } from './dialog-backdrops.mjs';

export function registerGeneratedConsumer({ test, expect, transport, configure, generatedFixture }) {
  test('dialog backdrop generated consumer protects gestures and returns focus', async ({ page }) => {
    const fixture = generatedFixture();
    await transport(page, undefined, { auto: true, work: true, ...fixture }); await configure(page);
    await injectGeneratedImage({ execute: (fn, arg) => page.evaluate(fn, arg) }, {
      image: { ...fixture.generatedImages[0], imageId: 'a'.repeat(32) }, bytes: fixture.generatedPng });
    await page.locator('.add-runner').click();
    const opener = page.locator('.generated-image-preview');
    await expect(opener.locator('img')).toHaveJSProperty('naturalWidth', 2);
    await opener.click();
    await imageBackdrop(page, expect, opener);
  });
  for (const failure of ['byte-length', 'identity', 'unsupported-mime']) {
    test('generated consumer rejects ' + failure, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true, ...generatedFixture() }); await configure(page);
      const fixture = animatedFixture();
      if (failure === 'unsupported-mime') fixture.image.mimeType = 'image/webp';
      await injectGeneratedImage({ execute: (fn, arg) => page.evaluate(fn, arg) }, fixture);
      await page.evaluate(failure => {
        const bridge = window.__TAURI_INTERNALS__, original = bridge.invoke;
        bridge.invoke = async (command, args, ...rest) => {
          const result = await original(command, args, ...rest);
          if (command !== 'runner_image_read') return result;
          const copy = structuredClone(result);
          if (failure === 'byte-length') copy.bytes.pop();
          if (failure === 'identity') copy.image.sourceSequence++;
          return copy;
        };
      }, failure);
      await page.locator('.add-runner').click();
      await expect(page.locator('.generated-images')).toHaveAttribute('data-state', 'failed');
      await expect(page.locator('.generated-image-preview img')).toHaveCount(0);
    });
  }
  for (const mode of ['populated', 'gif', 'empty', 'no-input']) {
    const populated = mode !== 'empty';
    test('generated consumer capability ' + mode, async ({ page }, info) => {
      const fixture = generatedFixture();
      if (!populated) fixture.generatedImages = [];
      await transport(page, undefined, { auto: true, work: true, ...fixture }); await configure(page);
      // Native helper callbacks take one structured argument; this adapts only test execution.
      const browser = { execute: (fn, arg) => page.evaluate(fn, arg),
        takeScreenshot: async () => (await page.screenshot()).toString('base64'),
        waitUntil: predicate => expect.poll(predicate).toBeTruthy() };
      if (populated) await injectGeneratedImage(browser, mode === 'gif' ? animatedFixture() : {
        image: { ...fixture.generatedImages[0], imageId: 'a'.repeat(32) }, bytes: fixture.generatedPng });
      await watchObservations(browser);
      const viewport = page.locator('.focused-image-viewport');
      const result = await generatedSource(browser, mode === 'no-input' ? undefined : {
        wheel: async delta => {
          const box = await viewport.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, delta);
        },
        pan: async () => {
          const box = await viewport.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35);
          await page.mouse.up();
        },
        escape: () => page.keyboard.press('Escape')
      });
      if (populated) {
        expect(result.properties).toEqual({ R04: 'supported', R05: { header: 'supported',
          escape: mode === 'no-input' ? 'unverified' : 'supported' }, R06: mode === 'no-input' ? 'unverified' : 'supported' });
        if (mode === 'no-input') expect(result.interactionLimit).toContain('No authorized input adapter');
        expect(result.image.sha256).toBe(mode === 'gif' ? animatedFixture().image.sha256 : fixture.generatedImages[0].sha256);
      } else {
        expect(result.outcome).toBe('unavailable');
        expect(result.reason).toContain('has no genuine generated image');
        await expect(page.locator('.focused-viewer[open]')).toHaveCount(0);
      }
      await info.attach('generated-consumer-fixture-observation', { body: JSON.stringify({
        classification: 'Synthetic transport and PNG/GIF; consumer coverage only, no genuine provenance', result }), contentType: 'application/json' });
    });
  }
}
