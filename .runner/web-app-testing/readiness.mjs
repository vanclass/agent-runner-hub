import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function failure(code, message, cause) {
  return Object.assign(new Error(`${code}: ${message}`, { cause }), { code });
}
export async function verifyChromium() {
  const actual = require('@playwright/test/package.json').version;
  if (actual !== '1.56.1') {
    throw failure('WEB_APP_BROWSER_VERSION', `Required @playwright/test 1.56.1; installed ${actual}. Review/Apply Settings or npm install.`);
  }
  const executable = chromium.executablePath();
  if (!existsSync(executable)) {
    throw failure('WEB_APP_BROWSER_UNAVAILABLE', `Chromium is missing at ${executable}. Run npm run test:e2e:prepare with network access.`);
  }
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true, handleSIGINT: false, timeout: 30_000 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('about:blank');
    await page.evaluate(() => document.body.textContent = 'Chromium ready');
    const version = browser.version();
    const metadata = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json'));
    const expected = metadata.browsers.find(item => item.name === 'chromium').browserVersion;
    if (version !== expected) throw new Error(`Expected Chromium ${expected}, observed ${version}`);
    await context.close();
    return { playwright: actual, chromium: version, executable };
  } catch (error) {
    throw failure('WEB_APP_BROWSER_LAUNCH_FAILED', `${error.message}. Run npm run test:e2e:prepare; inspect OS dependencies and executable permissions.`, error);
  } finally {
    if (browser) {
      await browser.close();
      if (browser.isConnected()) throw new Error('WEB_APP_BROWSER_CLEANUP_FAILED: Chromium did not disconnect.');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log('WEB_APP_BROWSER_READY', JSON.stringify(await verifyChromium()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
