import { expect as playwrightExpect } from '@playwright/test';

// Adapt the existing Playwright fixture to the WebView execution interface.
export function testBrowser(page, expect = playwrightExpect) {
  return {
    options: { waitforTimeout: 10_000 },
    execute: (fn, ...args) => page.evaluate(({ source, args }) => (0, eval)('(' + source + ')')(...args),
      { source: fn.toString(), args }),
    waitUntil: async predicate => { await expect.poll(predicate).toBeTruthy(); },
    takeScreenshot: async () => (await page.screenshot()).toString('base64')
  };
}
