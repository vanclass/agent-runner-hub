import { generatedSource } from '../native/webdriver/attachment-preview.mjs';
import { watchObservations } from '../native/webdriver/runner-flow.mjs';

export function registerGeneratedConsumer({ test, expect, transport, configure, generatedFixture }) {
  for (const mode of ['populated', 'empty', 'no-input']) {
    const populated = mode !== 'empty';
    test('generated consumer capability ' + mode, async ({ page }, info) => {
      const fixture = generatedFixture();
      if (!populated) fixture.generatedImages = [];
      await transport(page, undefined, { auto: true, work: true, ...fixture }); await configure(page);
      // Native helper callbacks take one structured argument; this adapts only test execution.
      const browser = { execute: (fn, arg) => page.evaluate(fn, arg),
        waitUntil: predicate => expect.poll(predicate).toBeTruthy() };
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
        expect(result.image.sha256).toBe(fixture.generatedImages[0].sha256);
      } else {
        expect(result.outcome).toBe('unavailable');
        expect(result.reason).toContain('has no genuine generated image');
        await expect(page.locator('.focused-viewer[open]')).toHaveCount(0);
      }
      await info.attach('generated-consumer-fixture-observation', { body: JSON.stringify({
        classification: 'Synthetic transport and PNG; capability coverage only, no genuine provenance', result }), contentType: 'application/json' });
    });
  }
}
