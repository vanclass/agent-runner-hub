import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  baseURL: async ({}, use) => {
    const url = process.env.RUNNER_WEB_APP_URL;
    if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
      throw new Error('WEB_APP_SERVER_NOT_READY: Use npm run test:e2e and import this fixture for owned server navigation.');
    }
    await use(url);
  },
  pageHealth: [async ({ page }, use, testInfo) => {
    const errors = [];
    const pageError = error => errors.push(`pageerror: ${error.message}`);
    const consoleError = message => {
      if (message.type() !== 'error') return;
      // Chromium requests an implicit favicon even when the application declares none.
      if (/\/favicon\.ico$/.test(message.location().url) && message.text().startsWith('Failed to load resource:')) return;
      errors.push(`console: ${message.text()}`);
    };
    page.on('pageerror', pageError);
    page.on('console', consoleError);
    await use();
    page.removeListener('pageerror', pageError);
    page.removeListener('console', consoleError);
    if (errors.length) {
      await testInfo.attach('page-errors', { body: errors.join('\n'), contentType: 'text/plain' });
    }
    expect(errors, 'The application must load and interact without JavaScript or console errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
