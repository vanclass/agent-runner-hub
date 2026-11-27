import { PNG } from 'pngjs';
import { chooseAppPreference, openAppEntry, appItem } from './application-menu.mjs';

const ansi = [
  ...Array.from({ length: 8 }, (_, i) => [String(30 + i), `Standard${i}`]),
  ...Array.from({ length: 8 }, (_, i) => [String(90 + i), `Bright${i}`]),
  ['38;5;16', 'IndexedBlack'], ['38;5;231', 'IndexedWhite'],
  ['38;2;16;17;18', 'RgbDark'], ['38;2;250;249;248', 'RgbLight'],
];
const terminalSample = ['Ordinary', '한국어 English', ...ansi.map(([code, label]) => `\x1b[${code}m${label}\x1b[0m`),
  '\x1b[1;32mSuccess\x1b[0m \x1b[1;33mWarning\x1b[0m \x1b[1;31mError\x1b[0m'].join('\r\n');

function luminance(rgb) {
  return rgb.map(value => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

export function registerPtyViewport({ test, expect, transport, configure, create }) {
  test('Runner terminal theme viewport', async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true });
    await page.addInitScript(sample => {
      if (!sessionStorage.getItem('terminal-theme-legacy')) {
        localStorage.setItem('agent-runner-hub.preferences.v1',
          JSON.stringify({ version: 1, language: 'en', theme: 'light', singleEntry: {} }));
        sessionStorage.setItem('terminal-theme-legacy', 'true');
      }
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      native.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command === 'pty_open') window.__nativeFixture.emit(result, sample + '\r\n');
        return result;
      };
    }, terminalSample);
    await configure(page);
    await create(page);
    const host = page.locator('.terminal-host');
    const rows = host.locator('.xterm-rows');
    const choose = async (submenu, value) => {
      await chooseAppPreference(page, 'view', submenu, value);
      await page.keyboard.press('Escape');
    };
    await openAppEntry(page, 'view', 'terminal-theme');
    await expect(appItem(page, 'follow')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    for (const theme of ['light', 'black']) {
      await choose('theme', theme);
      await expect(rows).toContainText('한국어 English');
      const background = theme === 'light' ? [255, 255, 255] : [17, 18, 20];
      await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', `rgb(${background.join(', ')})`);
      const labels = ['Ordinary', ...ansi.map(([, label]) => label), 'Success', 'Warning', 'Error'];
      const colors = await rows.locator('span').evaluateAll((spans, labels) => Object.fromEntries(labels.map(label => {
        const span = spans.find(node => node.textContent.includes(label));
        return [label, span ? getComputedStyle(span).color.match(/\d+/g).map(Number) : null];
      })), labels);
      for (const label of labels) {
        expect(colors[label], label).not.toBeNull();
        expect(contrast(colors[label], background), label).toBeGreaterThanOrEqual(4.5);
      }
      expect(new Set(['Success', 'Warning', 'Error'].map(label => colors[label].join(','))).size).toBe(3);
      const screenshot = await host.screenshot();
      const png = PNG.sync.read(screenshot);
      const pixel = (x, y) => [...png.data.subarray(4 * (y * png.width + x), 4 * (y * png.width + x) + 3)];
      expect(pixel(8, png.height - 1)).toEqual(background);
      expect(pixel(png.width - 2, png.height - 1)).toEqual(background);
      await info.attach(`runner-terminal-${theme}`, { body: screenshot, contentType: 'image/png' });
    }
    const terminal = await host.locator('.xterm').elementHandle();
    const firstTab = page.locator('.runner-row.active .nav-row');
    const firstName = await firstTab.innerText();
    await rows.getByText('Ordinary', { exact: true }).dblclick({ force: true });
    await expect(host.locator('.xterm-selection > div').first()).toBeVisible();
    await choose('terminal-theme', 'light');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'black');
    await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await terminal.evaluate(node => node === document.querySelector('.terminal-host .xterm'))).toBe(true);
    const copied = await host.locator('.xterm-helper-textarea').evaluate(element => {
      const clipboardData = new DataTransfer();
      element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, clipboardData }));
      return clipboardData.getData('text/plain');
    });
    expect(copied).toBe('Ordinary');
    await choose('theme', 'light');
    await choose('terminal-theme', 'dark');
    await choose('theme', 'black');
    await choose('theme', 'light');
    await expect(page.locator('.hub')).toHaveAttribute('data-theme', 'light');
    await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(17, 18, 20)');
    await page.evaluate(() => {
      const fixture = window.__nativeFixture;
      for (const id of fixture.sessions.keys())
        fixture.emit(id, Array.from({ length: 70 }, (_, i) => `scroll line ${i}\r\n`).join(''));
    });
    await expect(rows).toContainText('scroll line 69');
    await host.hover();
    const track = host.locator('.xterm-scrollable-element > .scrollbar.vertical');
    const slider = track.locator('.slider');
    await expect(slider).toBeVisible();
    await expect(slider).toHaveCSS('background-color', 'rgb(104, 116, 135)');
    await page.mouse.wheel(0, -120);
    await expect(rows).not.toContainText('scroll line 69');
    const scrollToTop = async () => {
      await host.hover();
      const thumb = await slider.boundingBox();
      const rail = await track.boundingBox();
      const x = thumb.x + thumb.width / 2;
      await page.mouse.move(x, thumb.y + thumb.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, rail.y, { steps: 5 });
      await page.mouse.up();
    };
    await scrollToTop();
    await expect(rows).toContainText('Ordinary');
    await choose('terminal-theme', 'light');
    await expect(rows).toContainText('Ordinary');
    await expect(slider).toHaveCSS('background-color', 'rgb(137, 149, 165)');

    await create(page);
    await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await choose('terminal-theme', 'dark');
    const tabs = page.locator('.runner-row .nav-row');
    await tabs.filter({ hasText: firstName }).click();
    await scrollToTop();
    await expect(rows).toContainText('Ordinary');
    await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(17, 18, 20)');
    expect(await terminal.evaluate(node => node === document.querySelector('.terminal-host .xterm'))).toBe(true);
    await page.reload();
    await expect(tabs).toHaveCount(2);
    await tabs.filter({ hasText: firstName }).click();
    await expect(rows).toContainText('Ordinary');
    await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(17, 18, 20)');
    await openAppEntry(page, 'view', 'terminal-theme');
    await expect(appItem(page, 'dark')).toHaveAttribute('aria-checked', 'true');
    await appItem(page, 'follow').click();
    await expect(host.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });
  for (const capability of [true, false, undefined]) test(`Original PTY output with semantic capability ${capability}`, async ({ page }, info) => {
    await transport(page, undefined, { work: true, auto: true });
    await page.addInitScript(capability => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      window.__presentationRequests = [];
      native.invoke = async (command, args) => {
        if (command === 'runner_presentation') { window.__presentationRequests.push(args); throw Error('obsolete subscription'); }
        const result = await original(command, args);
        if (command === 'runner_observe') result.presentationSupported = capability;
        if (command === 'pty_open') window.__nativeFixture.emit(result,
          '\r\nRunner prompt >\r\n\x1b[31mRunner error\x1b[0m\r\n\x1b[?9001$p\x1b[5n');
        return result;
      };
    }, capability);
    await configure(page); await create(page);
    await expect(page.locator('.terminal-host')).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('Runner prompt >');
    await expect(page.locator('.xterm-rows')).toContainText('Runner error');
    await expect(page.locator('.runner-semantic')).toHaveCount(0);
    await expect(page.locator('.presentation-limitation')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__nativeFixture.writes.length)).toBeGreaterThan(0);
    const before = await page.evaluate(() => window.__nativeFixture.writes);
    await page.locator('.xterm-helper-textarea').press('x');
    await page.locator('.xterm-helper-textarea').press('Enter');
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual(before);
    expect(await page.evaluate(() => window.__presentationRequests)).toEqual([]);
    await info.attach('pty-visible', { body: await page.screenshot(), contentType: 'image/png' });
  });
  for (const single of [false, true]) for (const long of [false, true]) test(`Original PTY submitted text Runner-owned Single Entry ${single} long ${long}`, async ({ page }) => {
    await transport(page, undefined, { work: true, auto: true });
    await page.addInitScript(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      native.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command === 'runner_observe') result.presentationSupported = true;
        if (command === 'runner_feature' && args.request.request?.operation === 'work.submit')
          window.__nativeFixture.emit(args.id, '\r\n' + args.request.request.instruction.replaceAll('\n', '\r\n') + '\r\n');
        return result;
      };
    });
    await configure(page); if (!single) await create(page);
    await expect(page.getByRole('combobox', { name: 'Requested Model', exact: true }).getByRole('option', { name: 'm0', exact: true })).toBeAttached();
    await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
    const input = page.locator('textarea[data-instruction]');
    await expect(input).toBeEnabled();
    const draft = '원본 submitted instruction\n' + (long ? '한국어 English multiline\n'.repeat(12) : '') + 'English multiline 끝';
    await input.fill(draft); await input.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('원본 submitted instruction');
    await expect(page.locator('.xterm-rows')).toContainText('English multiline 끝');
    await expect(input).toHaveValue('', { timeout: 35000 });
    expect((await page.locator('.xterm-rows').innerText()).match(/원본 submitted instruction/g)).toHaveLength(1);
    expect(await page.evaluate(() => [...window.__nativeFixture.sessions.values()].flatMap(s => s.feature.requests)
      .filter(r => r.operation === 'work.submit').length)).toBe(1);
    expect(await page.evaluate(() => window.__nativeFixture.writes)).toEqual([]);
  });
}
