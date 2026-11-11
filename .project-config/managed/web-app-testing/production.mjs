import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChromium } from './readiness.mjs';

const USAGE = `Usage: node .project-config/managed/web-app-testing/production.mjs --origin https://site.example --path / [--path /ko/] [--viewport 390x844] [--viewport 320x844] [--keyboard-link /products/]
       node .project-config/managed/web-app-testing/production.mjs --preflight

Checks publicly reachable, anonymous pages in an isolated Chromium process. The optional
keyboard link must be a same-origin relative href on the first requested page.
For authenticated websites or installed extensions, use their separate authorized owners.
`;
const CAPABILITIES = {
  viewport: 'isolated Chromium viewport',
  keyboard: 'real page Tab/Shift+Tab; optional Enter on an explicit same-origin link',
  scope: 'anonymous website; no installed user extensions, cookies, or Chrome profiles',
  limitation: 'not a physical-device, installed-extension, or full accessibility acceptance',
};

function options(args) {
  const result = { paths: [], viewports: [], origin: null, keyboardLink: null, preflight: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') return { help: true };
    if (arg === '--preflight') { result.preflight = true; continue; }
    if (!['--origin', '--path', '--viewport', '--keyboard-link'].includes(arg) || !args[i + 1]) {
      throw new Error(`WEB_APP_PRODUCTION_ARGUMENT_INVALID: ${arg}`);
    }
    const value = args[++i];
    if (value.startsWith('--')) throw new Error(`WEB_APP_PRODUCTION_ARGUMENT_INVALID: ${arg}`);
    if (arg === '--origin') {
      if (result.origin !== null) throw new Error('WEB_APP_PRODUCTION_ARGUMENT_INVALID: duplicate origin');
      const url = new URL(value);
      const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
      if (!(url.protocol === 'https:' || local) || url.username || url.password ||
          url.search || url.hash || url.pathname !== '/' || !url.hostname) {
        throw new Error('WEB_APP_PRODUCTION_ORIGIN_INVALID: require an HTTPS origin (or explicit 127.0.0.1 fixture origin) without credentials, path or query');
      }
      result.origin = url.origin;
    } else if (arg === '--path' || arg === '--keyboard-link') {
      if (!value.startsWith('/') || value.startsWith('//') || value.includes('#') ||
          value.includes('\\') || value.split('?')[0].split('/').some(s => s === '..' || s === '.')) {
        throw new Error(`WEB_APP_PRODUCTION_PATH_INVALID: ${value}`);
      }
      if (arg === '--path') result.paths.push(value);
      else if (result.keyboardLink !== null) throw new Error('WEB_APP_PRODUCTION_ARGUMENT_INVALID: duplicate keyboard link');
      else result.keyboardLink = value;
    } else {
      const match = /^(\d{3,4})x(\d{3,4})$/.exec(value);
      if (!match || +match[1] < 240 || +match[1] > 4096 || +match[2] < 320 || +match[2] > 4096) {
        throw new Error(`WEB_APP_PRODUCTION_VIEWPORT_INVALID: ${value}`);
      }
      result.viewports.push({ width: +match[1], height: +match[2] });
    }
  }
  if (!result.preflight && !result.origin) throw new Error('WEB_APP_PRODUCTION_TARGET_REQUIRED: supply --origin');
  result.paths = result.paths.length ? result.paths : ['/'];
  result.viewports = result.viewports.length ? result.viewports : [{ width: 390, height: 844 }, { width: 320, height: 844 }];
  if (result.paths.length > 32 || result.viewports.length > 8) {
    throw new Error('WEB_APP_PRODUCTION_ARGUMENT_INVALID: at most 32 paths and 8 viewports');
  }
  if (result.origin) {
    for (const item of [...result.paths, ...(result.keyboardLink ? [result.keyboardLink] : [])]) {
      const target = new URL(item, result.origin);
      if (target.origin !== result.origin) throw new Error(`WEB_APP_PRODUCTION_ORIGIN_MISMATCH: ${item}`);
    }
  }
  return result;
}

async function focusProbe(page, explicitLink, origin, check) {
  const result = { type: explicitLink ? 'navigation' : 'focus-only', keys: [], focusVisible: false };
  let firstFocus;
  for (let i = 0; i < (explicitLink ? 40 : 1); i++) {
    await check('keyboard Tab');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const style = el ? getComputedStyle(el) : null;
      return { tag: el?.tagName ?? '', href: el?.getAttribute('href') ?? '',
        visible: Boolean(el?.matches(':focus-visible')),
        outline: style?.outlineStyle ?? '', outlineWidth: style?.outlineWidth ?? '' };
    });
    result.keys.push({ key: 'Tab', ...focus });
    if (i === 0) firstFocus = focus;
    if (explicitLink && focus.href === explicitLink) {
      result.focusVisible = focus.visible && focus.outline !== 'none' && focus.outlineWidth !== '0px';
      if (!result.focusVisible) throw new Error('WEB_APP_PRODUCTION_FOCUS_INVISIBLE');
      const destination = new URL(focus.href, origin);
      if (destination.origin !== origin) throw new Error('WEB_APP_PRODUCTION_KEYBOARD_ORIGIN_MISMATCH');
      await Promise.all([page.waitForURL(destination.href, { timeout: 10000 }), page.keyboard.press('Enter')]);
      await check('keyboard navigation');
      result.keys.push({ key: 'Enter', destination: page.url() });
      result.navigationVerified = true;
      return result;
    }
  }
  if (explicitLink) throw new Error(`WEB_APP_PRODUCTION_KEYBOARD_TARGET_NOT_FOUND: ${explicitLink}`);
  result.focusVisible = firstFocus?.visible === true && firstFocus?.outline !== 'none' && firstFocus?.outlineWidth !== '0px';
  if (!result.focusVisible) throw new Error('WEB_APP_PRODUCTION_FOCUS_INVISIBLE');
  await check('keyboard Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  result.keys.push({ key: 'Shift+Tab' });
  return result;
}

async function challengeEvidence(page) {
  const selector = '#challenge-stage, #challenge-running, [id^="cf-chl-"], iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey]';
  for (const marker of await page.locator(selector).all()) {
    if (await marker.isVisible()) return { kind: 'visible-challenge-marker',
      marker: await marker.evaluate(node => ({ tag: node.tagName, id: node.id,
        frameHost: node.tagName === 'IFRAME' ? new URL(node.src, document.baseURI).hostname : null })) };
  }
  const messages = page.locator('body > .main-wrapper[role="main"] > .main-content > .h2');
  for (const message of await messages.all()) {
    if (!await message.isVisible()) continue;
    const text = (await message.innerText()).replace(/\s+/g, ' ').trim();
    if (!/^(?:Verifying you are human|Verify you are human|\uC0AC\uB78C\uC778\uC9C0 \uD655\uC778\uD558\uC2ED\uC2DC\uC624)(?:[.!\u2026]|\s|$)/.test(text)) continue;
    const rays = await page.locator('body > .footer .ray-id code').all();
    if (!(await Promise.all(rays.map(ray => ray.isVisible()))).some(Boolean)) continue;
    for (const link of await page.locator('body > .footer #footer-text a[href]').all()) {
      if (await link.isVisible() && await link.evaluate(node => {
        const url = new URL(node.href);
        return url.hostname === 'www.cloudflare.com' && url.searchParams.get('utm_source') === 'challenge';
      })) return { kind: 'visible-cloudflare-verification-shell', text };
    }
  }
  return null;
}

async function main() {
  const selected = options(process.argv.slice(2));
  if (selected.help) { process.stdout.write(USAGE); return; }
  const root = realpathSync(process.cwd());
  if (root !== realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))) {
    throw new Error('WEB_APP_CHECKOUT_MISMATCH: run from this Web App checkout');
  }
  const ready = await verifyChromium();
  if (selected.preflight) {
    console.log('WEB_APP_PRODUCTION_PREFLIGHT', JSON.stringify({ status: 'ready', browser: ready.chromium, capabilities: CAPABILITIES }));
    return;
  }
  const artifacts = path.join(root, 'test-results/web-app', `production-${randomUUID()}`);
  await mkdir(artifacts, { recursive: true });
  const report = { kind: 'public-site-acceptance', origin: selected.origin, playwright: ready.playwright,
    chromium: ready.chromium, capabilities: CAPABILITIES, viewports: selected.viewports,
    paths: selected.paths, results: [], keyboard: [], settlement: 'unverified' };
  let server, browser, ownedProcess;
  let cancelled = false;
  const cancel = () => { cancelled = true; void browser?.close().catch(() => {}); };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  let activePage, activeObservation;
  async function check(operation) {
    if (cancelled) throw new Error('WEB_APP_PRODUCTION_CANCELLED');
    if (report.terminal) throw new Error(report.terminal.code);
    const httpStatus = activeObservation.httpStatus;
    const codes = { 401: 'AUTHENTICATION_REQUIRED', 403: 'ACCESS_DENIED', 429: 'RATE_LIMITED' };
    const challenge = codes[httpStatus] ? null : await challengeEvidence(activePage);
    if (!codes[httpStatus] && !challenge) return;
    report.terminal = { code: `WEB_APP_PRODUCTION_${codes[httpStatus] || 'HUMAN_VERIFICATION_REQUIRED'}`,
      operation, url: activePage.url(), httpStatus, challenge,
      nextAction: httpStatus === 401
        ? 'Stop. If the task requires an authorized logged-in website session, use enrolled Browser Control under that authority.'
        : httpStatus === 429 ? 'Stop. Respect the rate limit; no automatic retry.'
        : challenge ? 'Stop. Human verification is required; do not solve or bypass it in this execution.'
        : 'Stop. Review host access requirements with the site owner; do not assume login or a browser switch resolves denial.' };
    activeObservation.status = 'blocked';
    activeObservation.restriction = report.terminal;
    throw new Error(report.terminal.code);
  }
  try {
    server = await chromium.launchServer({ headless: true, channel: 'chromium', host: '127.0.0.1',
      handleSIGINT: false, handleSIGTERM: false, timeout: 30000 });
    ownedProcess = server.process();
    if (!ownedProcess?.pid) throw new Error('WEB_APP_PRODUCTION_BROWSER_OWNER_UNAVAILABLE');
    report.browserOwner = { pid: ownedProcess.pid,
      profile: ownedProcess.spawnargs.find(arg => arg.startsWith('--user-data-dir='))?.slice(16),
      listener: new URL(server.wsEndpoint()).host };
    browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
    execution: for (const viewport of selected.viewports) {
      if (cancelled) break;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await context.route('**/*', route => report.terminal || cancelled ? route.abort() : route.continue());
      try {
        for (let i = 0; i < selected.paths.length; i++) {
          const route = selected.paths[i];
          const url = new URL(route, selected.origin).href;
          const page = await context.newPage();
          const observation = { url, viewport, status: 'unverified' };
          activePage = page;
          activeObservation = observation;
          page.on('response', response => {
            if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
              observation.httpStatus = response.status();
              observation.finalUrl = response.url();
            }
          });
          const scriptErrors = [];
          page.on('pageerror', error => scriptErrors.push(error.message));
          try {
            if (cancelled) throw new Error('WEB_APP_PRODUCTION_CANCELLED');
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            observation.httpStatus = response?.status() ?? null;
            observation.finalUrl = page.url();
            await check('navigation');
            await page.waitForLoadState('load', { timeout: 15000 });
            await check('page readiness');
            await page.waitForFunction(() => Boolean(document.body?.innerText?.trim()), null, { timeout: 5000 });
            await page.evaluate(() => document.fonts?.ready);
            const metrics = await page.evaluate(() => ({
              lang: document.documentElement.lang,
              title: document.title,
              textLength: document.body?.innerText?.trim().length ?? 0,
              overflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) > innerWidth,
              brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).length,
            }));
            observation.httpStatus = response?.status() ?? null;
            observation.finalUrl = page.url();
            observation.metrics = metrics;
            const screenshot = `page-${viewport.width}x${viewport.height}-${i + 1}.png`;
            await check('screenshot');
            await page.screenshot({ path: path.join(artifacts, screenshot), fullPage: true, animations: 'disabled' });
            observation.screenshot = screenshot;
            if (i === 0) {
              observation.keyboard = await focusProbe(page, selected.keyboardLink, selected.origin, check);
              report.keyboard.push({ viewport, ...observation.keyboard });
            }
            observation.pageErrors = scriptErrors;
            observation.status = response?.status() === 200 && observation.finalUrl === url &&
              !metrics.overflow && metrics.brokenImages === 0 && metrics.textLength > 0 &&
              scriptErrors.length === 0 ? 'passed' : 'failed';
          } catch (error) {
            if (!report.terminal) {
              try { await check('page failure'); } catch (restriction) {
                if (report.terminal) error = restriction;
              }
            }
            observation.status = report.terminal ? 'blocked' : 'failed';
            observation.failure = String(error.message ?? error);
          } finally {
            report.results.push(observation);
            await page.close();
          }
          if (report.terminal || cancelled) break execution;
        }
      } finally { await context.close(); }
    }
  } finally {
    let cleanupError;
    try { if (browser) await browser.close(); } catch (error) { cleanupError = String(error); }
    try { if (server) await server.close(); } catch (error) { cleanupError ||= String(error); }
    report.settlement = ownedProcess?.exitCode === 0 ? 'settled' : 'unverified';
    if (report.browserOwner) {
      report.browserOwner.exitCode = ownedProcess.exitCode;
      report.browserOwner.profileRemoved = Boolean(report.browserOwner.profile) && !existsSync(report.browserOwner.profile);
      if (!report.browserOwner.profileRemoved) report.settlement = 'unverified';
    }
    if (cancelled) report.cancellation = 'WEB_APP_PRODUCTION_CANCELLED';
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    if (cleanupError) {
      report.cleanupError = cleanupError;
      report.settlement = 'unverified';
    }
    await writeFile(path.join(artifacts, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('WEB_APP_PRODUCTION_RESULTS', JSON.stringify({ artifacts, results: report.results.length,
      failed: report.results.filter(item => item.status !== 'passed').length, settlement: report.settlement,
      terminal: report.terminal ?? null }));
    if (cancelled || cleanupError || report.results.some(item => item.status !== 'passed') || report.settlement !== 'settled') process.exitCode = 1;
  }
}

main().catch(error => { console.error(String(error.message ?? error)); process.exitCode = 1; });
