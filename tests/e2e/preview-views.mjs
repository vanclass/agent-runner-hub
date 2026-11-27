import { appTrigger, chooseAppPreference, openAppEntry } from './application-menu.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { imageBackdrop, registerOrdinaryBackdrops } from './dialog-backdrops.mjs';
import { HubActions } from '../native/webdriver/hub-actions.mjs';
import { testBrowser } from './test-browser.mjs';
import { animationFrames, animatedFixture } from '../native/webdriver/attachment-preview.mjs';
const png = [...PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640 * 320 * 4, 180) })];
const pdf = readFileSync(new URL('../../src-tauri/test-fixtures/preview-sample.pdf', import.meta.url)).toString('base64');
const markdown = readFileSync(new URL('../../src-tauri/test-fixtures/preview-sample.md', import.meta.url), 'utf8')
  + '\n\n' + ['| Header '.repeat(9) + '|', '| --- '.repeat(9) + '|', '| Cell '.repeat(9) + '|'].join('\n')
  + '\n\n```\n' + 'wide line '.repeat(25) + '\n```\n';
const original = '  첫 번째 줄\n# 원문 <script>window.previewExecuted=true</script>\n{"값": "한글"}\n  ';
const source = '\tconst start = "Find.Me";\r\n' + '// 공백 유지\r\n'.repeat(64)
  + 'const end = "find.me"; // ' + 'long line '.repeat(30) + '\r\n  ';
const json = '\uFEFF {\r\n  "9": 900719925474099312345, "2": 1.234567890123456789e+400,\r\n'
  + '  "9": -0, "nested": {"values": [true, null, "한글", {}, []]}\r\n}\t\r\n';
const records = '{"id":900719925474099312345,"data":[false]}\r\n{"bad":}\n\n'
  + '"a\\nb"\rnull\n' + '0\n'.repeat(100) + '{"last":true}\n';

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
  async function captureClipboardInput(page) {
    await page.evaluate(() => {
      const clipboard = navigator.clipboard;
      const write = clipboard.writeText.bind(clipboard);
      clipboard.writeText = text => {
        window.previewClipboardInput = text;
        return write(text);
      };
    });
  }
  async function setup(page, entry = false) {
    await ready(page);
    await page.evaluate(({ png, gif, original, source, pdf, json, records, markdown }) => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command !== 'local_file_preview') return invoke(command, args);
        if (args.path.endsWith('/preview-sample.pdf')) return { kind: 'pdf', path: args.path, base64: pdf };
        if (args.path.endsWith('/malformed.pdf')) return { kind: 'pdf', path: args.path, base64: btoa('%PDF-1.4\ninvalid') };
        if (args.path.endsWith('/listing.ZIP')) return { kind: 'archive', path: args.path, entries: [
          { name: 'empty/', directory: true, size: '0' },
          { name: 'docs/nested/notes.txt', directory: false, size: '1536' },
          { name: 'docs/<script>.txt', directory: false, size: '25' },
          { name: '../literal.txt', directory: false, size: '0' },
          ...Array.from({ length: 35 }, (_, index) => ({ name: 'file-' + index, directory: false, size: '1048576' })),
        ] };
        if (args.path.endsWith('/malformed.zip')) return { kind: 'unavailable', path: args.path, reason: 'decoding' };
        if (args.path.endsWith('.png')) return { kind: 'image', path: args.path, mime: 'image/png', base64: btoa(String.fromCharCode(...png)) };
        if (args.path.endsWith('.gif')) return { kind: 'image', path: args.path, mime: 'image/gif', base64: btoa(String.fromCharCode(...gif)) };
        if (args.path.endsWith('/structured.JSON')) {
          window.structuredPreviewReads = (window.structuredPreviewReads ?? 0) + 1;
          return { kind: 'text', path: args.path, text: json };
        }
        if (args.path.endsWith('/records.jsonl')) return { kind: 'text', path: args.path, text: records };
        if (args.path.endsWith('/preview-sample.md')) {
          window.markdownPreviewReads = (window.markdownPreviewReads ?? 0) + 1;
          return { kind: 'text', path: args.path, text: markdown };
        }
        if (args.path.endsWith('/large.md')) return { kind: 'text', path: args.path, text: 'x'.repeat(300_000) + '\nLast line  ' };
        if (/\.(txt|md|json)$/.test(args.path) && !args.path.includes('missing')) return { kind: 'text', path: args.path, text: original };
        if (args.path.endsWith('.ts')) return { kind: 'text', path: args.path, text: source };
        if (args.path.endsWith('/.gitignore') || args.path.endsWith('.log')) return { kind: 'text', path: args.path, text: '  # exact\n/dist/\n' };
        return { kind: 'unavailable', path: args.path, reason: 'unsupported' };
      };
    }, { png, gif: animatedFixture().bytes, original, source, pdf, json, records, markdown });
    if (entry) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
  }
  async function verifyLocalizedArchive(page, expect, info, viewer) {
    await chooseAppPreference(page, 'view', 'theme', 'black');
    await page.keyboard.press('Escape');
    await chooseAppPreference(page, 'settings', 'language', 'ko');
    await page.keyboard.press('Escape');
    const opener = page.getByRole('button', { name: '첨부 파일 listing.ZIP 열기' });
    await opener.click();
    await expect(viewer.getByRole('region', { name: '압축 파일 내용' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: '닫기' })).toBeVisible();
    await expect(viewer).toHaveCSS('background-color', 'rgb(17, 18, 20)');
    await info.attach('archive-korean-black', { body: await viewer.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    const malformed = page.getByRole('button', { name: '첨부 파일 malformed.zip 열기' });
    await malformed.click();
    await expect(page.getByRole('dialog', { name: 'malformed.zip' })).toContainText('첨부는 유지됩니다');
    await page.keyboard.press('Escape');
    await expect(malformed).toBeFocused();
    await expect(page.locator('.attachment-chip')).toHaveCount(2);
  }
  for (const entry of [false, true]) {
    const label = entry ? 'Single Entry' : 'Runner';
    test('focused preview ' + label + ' animates GIF thumbnails and focused images', async ({ page }) => {
      await setup(page, entry);
      await drop(page, ['/fixture/two-frames.gif']);
      const opener = page.getByRole('button', { name: 'Open attachment two-frames.gif', exact: true });
      const thumbnail = opener.locator('img');
      await expect(thumbnail).toHaveJSProperty('naturalWidth', 2);
      expect(await thumbnail.evaluate(async img => (await (await fetch(img.src)).blob()).type)).toBe('image/gif');
      const browser = testBrowser(page, expect);
      await animationFrames(browser, '.attachment-chip img');
      await opener.click();
      await expect(page.locator('.focused-image-viewport img')).toHaveJSProperty('naturalWidth', 2);
      await animationFrames(browser, '.focused-image-viewport img');
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    });
    test('dialog backdrop attachment ' + label + ' protects gestures and returns focus', async ({ page }) => {
      await setup(page, entry); await drop(page, ['/fixture/backdrop.png']);
      const opener = page.getByRole('button', { name: 'Open attachment backdrop.png', exact: true });
      await opener.click();
      await expect(page.locator('.focused-image-viewport img')).toHaveJSProperty('naturalWidth', 640);
      await imageBackdrop(page, expect, opener);
    });
    test('focused preview ' + label + ' local image header, rendered gestures and reset', async ({ page }, info) => {
      await setup(page, entry); await drop(page, ['/fixture/first.png','/fixture/second.png']);
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
      await setup(page, entry);
      const paths = ['original.txt','original.md','original.json','.gitignore','build.log','missing.txt','unsupported.rar','folder'];
      await drop(page, paths.map(name => '/fixture/' + name));
      const { attachments } = new HubActions(testBrowser(page, expect));
      for (const [index, name] of paths.entries()) {
        await attachments.openPreview(entry ? 'single-entry' : 'runner', index);
        await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
        if (name.startsWith('original')) {
          await expect(page.locator('.focused-text')).toHaveJSProperty('textContent', original);
          expect(await page.evaluate(() => window.previewExecuted)).toBeUndefined();
        } else if (name === '.gitignore' || name === 'build.log') {
          const text = page.locator('.focused-text');
          await expect(text).toHaveJSProperty('textContent', '  # exact\n/dist/\n');
          await expect(text.locator('[class^="preview-token-"]')).toHaveCount(name === 'build.log' ? 0 : 1);
        } else await expect(page.locator('.focused-viewer[open] [role=status]')).toContainText('cannot be previewed');
        await page.keyboard.press('Escape');
        await expect(page.locator('.attachment-chip')).toHaveCount(paths.length);
      }
    });
  }
  test('focused ZIP preview lists implicit folders and sizes, scrolls and returns focus', async ({ page }, info) => {
    await setup(page);
    await drop(page, ['/fixture/listing.ZIP', '/fixture/malformed.zip']);
    const opener = page.getByRole('button', { name: 'Open attachment listing.ZIP' });
    await opener.click();
    const viewer = page.getByRole('dialog', { name: 'listing.ZIP', exact: true });
    const contents = viewer.getByRole('region', { name: 'Archive contents' });
    const docs = contents.locator('details').filter({ has: page.locator('summary', { hasText: /^docs$/ }) }).first();
    const notes = contents.getByText('notes.txt', { exact: true });
    await expect(notes).toBeHidden();
    await docs.locator('summary').first().press('Enter');
    await docs.getByText('nested', { exact: true }).click();
    await expect(notes).toBeVisible();
    await expect(notes.locator('..')).toContainText('1.5 KiB');
    await expect(contents.getByText('<script>.txt', { exact: true }).locator('..')).toContainText('25 B');
    await contents.getByText('..', { exact: true }).click();
    await expect(contents.getByText('literal.txt', { exact: true }).locator('..')).toContainText('0 B');
    await contents.getByText('empty', { exact: true }).click();
    await expect(contents.getByText('Empty', { exact: true })).toBeVisible();
    await info.attach('archive-light', { body: await viewer.screenshot(), contentType: 'image/png' });
    await docs.locator('summary').first().click();
    await expect(notes).toBeHidden();
    await contents.focus();
    await contents.press('End');
    await expect.poll(() => contents.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(contents.getByText('file-34', { exact: true })).toBeInViewport();
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(opener).toBeFocused();
    await verifyLocalizedArchive(page, expect, info, viewer);
  });

  test('focused PDF preview renders, navigates, zooms and releases the local document', async ({ page }, info) => {
    await setup(page);
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.pdfWorkers = { started: 0, terminated: 0 };
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); window.pdfWorkers.started++; }
        terminate() { super.terminate(); window.pdfWorkers.terminated++; }
      };
    });
    await drop(page, ['/fixture/preview-sample.pdf', '/fixture/malformed.pdf']);
    const opener = page.getByRole('button', { name: 'Open attachment preview-sample.pdf' });
    await opener.click();
    const viewer = page.getByRole('dialog', { name: 'preview-sample.pdf', exact: true });
    const number = viewer.getByRole('textbox', { name: 'Page number' });
    const canvas = pageNumber => viewer.locator(`[data-page="${pageNumber}"] canvas[data-rendered]`);
    await expect(canvas(1)).toBeVisible();
    await expect(viewer.getByText('of 4')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    const first = await canvas(1).boundingBox();
    expect(first.width / first.height).toBeCloseTo(2 / 3, 2);
    await expect.poll(() => canvas(1).evaluate(node => [...node.getContext('2d').getImageData(
      Math.round(node.width / 2), Math.round(node.height * 95 / 720), 1, 1,
    ).data])).toEqual([33, 79, 166, 255]);
    await info.attach('pdf-light', { body: await viewer.screenshot(), contentType: 'image/png' });
    await viewer.getByRole('button', { name: 'Next page' }).click();
    await expect(number).toHaveValue('2');
    await viewer.getByRole('button', { name: 'Previous page' }).click();
    await expect(number).toHaveValue('1');
    await number.fill('4');
    await number.press('Enter');
    await expect(number).toHaveValue('4');
    await expect(canvas(4)).toBeInViewport({ ratio: .25 });
    await expect(canvas(1)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Next page' })).toBeDisabled();
    const scroll = viewer.locator('.pdf-scroll');
    await scroll.evaluate(node => { node.scrollTop = node.querySelectorAll('.pdf-page-slot')[2].offsetTop; });
    await expect(number).toHaveValue('3');
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.getByText('125%')).toBeVisible();
    await expect.poll(async () => (await canvas(3).boundingBox())?.width ?? 0).toBeGreaterThan(first.width);
    await viewer.getByRole('button', { name: 'Zoom out' }).click();
    await expect(viewer.getByText('100%')).toBeVisible();
    const retainedCanvas = await canvas(3).elementHandle();
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(opener).toBeFocused();
    await expect.poll(() => retainedCanvas.evaluate(node => [node.width, node.height])).toEqual([0, 0]);
    await expect.poll(() => page.evaluate(() => window.pdfWorkers)).toEqual({ started: 1, terminated: 1 });
    await chooseAppPreference(page, 'view', 'theme', 'black');
    await page.keyboard.press('Escape');
    await chooseAppPreference(page, 'settings', 'language', 'ko');
    await page.keyboard.press('Escape');
    const koreanOpener = page.getByRole('button', { name: '첨부 파일 preview-sample.pdf 열기' });
    await koreanOpener.click();
    await expect(viewer.getByRole('textbox', { name: '페이지 번호' })).toHaveValue('1');
    await expect(viewer.getByRole('button', { name: '닫기' })).toBeVisible();
    await expect(canvas(1)).toBeVisible();
    await expect(viewer).toHaveCSS('background-color', 'rgb(17, 18, 20)');
    await info.attach('pdf-korean-black', { body: await viewer.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '첨부 파일 malformed.pdf 열기' }).click();
    await expect(page.getByRole('dialog', { name: 'malformed.pdf' })).toContainText('첨부는 유지됩니다');
    await page.keyboard.press('Escape');
    await expect(page.locator('.attachment-chip')).toHaveCount(2);
  });

  test('focused PDF preview renders every intersecting page at reduced zoom', async ({ page }, info) => {
    await setup(page);
    await drop(page, ['/fixture/preview-sample.pdf']);
    await page.setViewportSize({ width: 500, height: 1200 });
    await page.getByRole('button', { name: 'Open attachment preview-sample.pdf' }).click();
    const viewer = page.getByRole('dialog', { name: 'preview-sample.pdf', exact: true });
    const zoomOut = viewer.getByRole('button', { name: 'Zoom out' });
    await zoomOut.click();
    await zoomOut.click();
    await expect(viewer.getByText('50%')).toBeVisible();
    await expect(viewer.getByRole('textbox', { name: 'Page number' })).toHaveValue('1');
    await expect(viewer.locator('[data-page="3"]')).toBeInViewport({ ratio: .3 });
    await expect.poll(() => viewer.locator('.pdf-scroll').evaluate(root => {
      const viewport = root.getBoundingClientRect();
      return [...root.querySelectorAll('[data-page]')].filter(node => {
        const page = node.getBoundingClientRect();
        return page.bottom > viewport.top && page.top < viewport.bottom && !node.querySelector('[data-rendered]');
      }).map(node => node.dataset.page);
    })).toEqual([]);
    await info.attach('pdf-reduced-zoom', { body: await viewer.screenshot(), contentType: 'image/png' });
  });

  test('closing a loading PDF discards its late native result', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      native.invoke = (command, args) => {
        if (command !== 'local_file_preview' || window.finishStalePdf) return invoke(command, args);
        return new Promise(resolve => {
          window.finishStalePdf = () => resolve({ kind: 'unavailable', path: args.path, reason: 'unreadable' });
        });
      };
    });
    await drop(page, ['/fixture/preview-sample.pdf']);
    const opener = page.getByRole('button', { name: 'Open attachment preview-sample.pdf' });
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'preview-sample.pdf' })).toContainText('Reading original file');
    await expect.poll(() => page.evaluate(() => typeof window.finishStalePdf)).toBe('function');
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await opener.click();
    await page.evaluate(() => window.finishStalePdf());
    await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeVisible();
  });

  test('focused preview source tools preserve original text across search, wrapping and copying', async ({ page, context }, info) => {

    await setup(page);
    await drop(page, ['/fixture/source.ts']);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const opener = page.getByRole('button', { name: 'Open attachment source.ts' });
    await opener.click();
    const viewer = page.getByRole('dialog', { name: 'source.ts' });
    const text = viewer.locator('.focused-text');
    await expect(text).toHaveJSProperty('textContent', source);
    await expect(viewer.getByRole('group', { name: 'Preview mode' })).toHaveCount(0);
    await expect(text.locator('.preview-token-keyword').first()).toHaveText('const');
    await expect(text.locator('.preview-line')).toHaveCount(67);
    const gutter = await text.locator('.preview-line').first().evaluate(node => getComputedStyle(node, '::before').content);
    expect(gutter).toContain('counter(preview-line)');
    await text.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => text.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const search = viewer.getByRole('searchbox', { name: 'Find in file' });
    await search.fill('find.me');
    await expect(viewer.getByRole('status')).toHaveText('1 of 2');
    await search.press('Enter');
    await expect(text.locator('mark')).toHaveText('find.me');
    await expect.poll(() => text.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await viewer.getByRole('button', { name: 'Previous match' }).click();
    await expect(text.locator('mark')).toHaveText('Find.Me');
    await search.fill('absent');
    await expect(viewer.getByRole('status')).toHaveText('No matches');
    await search.clear();
    const wrap = viewer.getByRole('button', { name: 'Word wrap' });
    await expect(wrap).toHaveAttribute('aria-pressed', 'true');
    await wrap.click();
    await expect(wrap).toHaveAttribute('aria-pressed', 'false');
    expect(await text.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await wrap.click();
    expect(await text.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(text).toHaveJSProperty('textContent', source);
    await viewer.getByRole('button', { name: 'Copy text' }).click();
    await expect(viewer.getByText('Original text copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
    await text.evaluate(node => { node.scrollTop = 0; });
    await info.attach('source-light', { body: await page.screenshot(), contentType: 'image/png' });
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toHaveCount(0);
    await expect(opener).toBeFocused();
    await chooseAppPreference(page, 'view', 'theme', 'black');
    await page.keyboard.press('Escape');
    await chooseAppPreference(page, 'settings', 'language', 'ko');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '첨부 파일 source.ts 열기' }).click();
    await expect(viewer.getByRole('searchbox', { name: '파일에서 찾기' })).toBeVisible();
    await expect(text).toHaveCSS('background-color', 'rgb(21, 22, 25)');
    await expect(viewer.getByRole('button', { name: '텍스트 복사' })).toBeVisible();
    await info.attach('source-korean-black', { body: await page.screenshot(), contentType: 'image/png' });
    await viewer.getByRole('searchbox').press('Escape');
    await expect(viewer).toHaveCount(0);
  });
  test('structured preview parser preserves lexemes and rejects invalid JSON grammar', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(async () => {
      const { parsePreviewJson: parse } = await import('/src/hub/previewJson.ts');
      return {
        keys: parse(String.raw`{"9":null,"2":true,"\u0039":false}`).entries.map(entry => entry.key),
        tokens: parse(String.raw`[-0,1.234567890123456789e+400,900719925474099312345,"a\n\u0041",{},[]]`).items,
        rejected: ['', '[1,]', '{"x":1,}', '{"a" 1}', '[01]', '1e+', 'null true', '"\t"', '"\\x"', '\u00a0true']
          .every(input => parse(input) === undefined),
        deep: parse('['.repeat(12000) + '0' + ']'.repeat(12000))?.kind,
      };
    });
    expect(result).toEqual({
      keys: ['"9"', '"2"', '"\\u0039"'],
      tokens: [
        ...['-0', '1.234567890123456789e+400', '900719925474099312345'].map(token => ({ kind: 'number', token })),
        { kind: 'string', token: '"a\\n\\u0041"' },
        { kind: 'object', entries: [] }, { kind: 'array', items: [] },
      ],
      rejected: true, deep: 'array',
    });
  });

  test('structured preview JSON switches in place and preserves the exact original', async ({ page, context }, info) => {
    await setup(page);
    await drop(page, ['/fixture/structured.JSON', '/fixture/original.json']);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await captureClipboardInput(page);
    const opener = page.getByRole('button', { name: 'Open attachment structured.JSON' });
    const dialog = page.getByRole('dialog', { name: 'structured.JSON', exact: true });
    await opener.click();
    const raw = dialog.getByRole('button', { name: 'Raw View' });
    const structured = dialog.getByRole('button', { name: 'JSON View' });
    const text = dialog.locator('.focused-text');
    await expect(raw).toHaveAttribute('aria-pressed', 'true');
    await expect(text).toHaveJSProperty('textContent', json);
    await expect(text.locator('.preview-token-literal').first()).toBeVisible();
    await expect(text.locator('.preview-line')).toHaveCount(5);
    const search = dialog.getByRole('searchbox'), wrap = dialog.getByRole('button', { name: 'Word wrap' });
    await search.fill('"9"');
    await search.press('Enter');
    await wrap.click();
    await structured.click();
    await expect(structured).toHaveAttribute('aria-pressed', 'true');
    await expect(search).toHaveCount(0);
    await expect(wrap).toHaveCount(0);
    await expect(text).toBeHidden();
    const tree = dialog.getByRole('region', { name: 'JSON View' });
    await expect(tree.locator('.preview-json-key')).toHaveText(['"9"', '"2"', '"9"', '"nested"']);
    await expect(tree.locator('.preview-json-number')).toHaveText(['900719925474099312345', '1.234567890123456789e+400', '-0']);
    const nested = tree.getByRole('button', { name: /"nested"/ });
    await nested.click();
    const values = tree.getByRole('button', { name: /"values"/ });
    await values.click();
    await expect(tree.locator('.preview-json-boolean')).toHaveText('true');
    await expect(tree.locator('.preview-json-null')).toHaveText('null');
    await expect(tree.locator('.preview-json-string')).toHaveText('"한글"');
    await expect(tree.getByText('{} (0)')).toBeVisible();
    await expect(tree.getByText('[] (0)')).toBeVisible();
    await info.attach('structured-json-light', { body: await dialog.screenshot(), contentType: 'image/png' });
    await nested.click();
    await expect(values).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Copy text' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(json);
    await raw.click();
    await expect(text).toBeVisible();
    await expect(search).toHaveValue('"9"');
    await expect(dialog.getByRole('status').filter({ hasText: '2 of 2' })).toBeVisible();
    await expect(wrap).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: 'Previous match' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: '1 of 2' })).toBeVisible();
    expect(await page.evaluate(() => window.structuredPreviewReads)).toBe(1);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(raw).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    const malformed = page.getByRole('button', { name: 'Open attachment original.json' });
    await malformed.click();
    const invalid = page.getByRole('dialog', { name: 'original.json', exact: true });
    await invalid.getByRole('button', { name: 'JSON View' }).click();
    await expect(invalid.getByRole('status')).toHaveText('Invalid JSON. Open Raw View to see the original text.');
    await invalid.getByRole('button', { name: 'Copy text' }).click();
    await expect(invalid.getByText('Original text copied')).toBeVisible();
    expect(await page.evaluate(() => window.previewClipboardInput)).toBe(original);
    await invalid.getByRole('button', { name: 'Raw View' }).click();
    await expect(invalid.locator('.focused-text')).toHaveJSProperty('textContent', original);
    await page.keyboard.press('Escape');
    await expect(malformed).toBeFocused();
  });

  test('structured preview JSONL keeps record boundaries and line numbers in Black theme', async ({ page, context }, info) => {
    await setup(page, true);
    await chooseAppPreference(page, 'view', 'theme', 'black');
    await page.keyboard.press('Escape');
    await chooseAppPreference(page, 'settings', 'language', 'ko');
    await page.keyboard.press('Escape');
    await drop(page, ['/fixture/records.jsonl']);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await captureClipboardInput(page);
    const opener = page.getByRole('button', { name: '첨부 파일 records.jsonl 열기' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'records.jsonl', exact: true });
    await expect(dialog.getByRole('button', { name: '원본 보기' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'JSON 보기', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: '레코드 보기' }).click();
    const list = dialog.getByRole('region', { name: '레코드 보기' });
    await expect(list).toHaveCSS('background-color', 'rgb(21, 22, 25)');
    const rows = list.locator('.preview-json-record');
    await expect(rows).toHaveCount(100);
    await expect(rows.nth(1)).toHaveText('2행올바른 JSON 레코드가 아닙니다.');
    await expect(rows.nth(2)).toHaveText('3행올바른 JSON 레코드가 아닙니다.');
    await expect(rows.nth(3).locator('.preview-json-string')).toHaveText('"a\\nb"');
    await expect(rows.nth(4)).toHaveText('5행null');
    await rows.first().getByRole('button', { name: /\{\}/ }).click();
    await expect(rows.first().locator('.preview-json-number')).toHaveText('900719925474099312345');
    await rows.first().getByRole('button', { name: /"data"/ }).click();
    await expect(rows.first().getByText('0', { exact: true })).toBeVisible();
    await expect(rows.first().locator('.preview-json-boolean')).toHaveText('false');
    await info.attach('structured-jsonl-korean-black', { body: await dialog.screenshot(), contentType: 'image/png' });
    await list.getByRole('button', { name: '6개 더 보기' }).click();
    await expect(rows.last()).toContainText('106행');
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: '텍스트 복사' }).click();
    await expect(dialog.getByText('원본 텍스트를 복사했습니다')).toBeVisible();
    expect(await page.evaluate(() => window.previewClipboardInput)).toBe(records);
    await dialog.getByRole('button', { name: '원본 보기' }).click();
    await expect(dialog.locator('.focused-text')).toHaveJSProperty('textContent', records);
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  });

  for (const dark of [false, true]) {
    test(`Markdown preview renders an inert attachment in ${dark ? 'Korean Black' : 'English Light'}`, async ({ page, context }, info) => {
      await setup(page, dark);
      await drop(page, ['/fixture/preview-sample.md']);
      if (dark) {
        await chooseAppPreference(page, 'view', 'theme', 'black');
        await page.keyboard.press('Escape');
        await chooseAppPreference(page, 'settings', 'language', 'ko');
        await page.keyboard.press('Escape');
      }
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await captureClipboardInput(page);
      const requests = [];
      await page.route('https://preview.invalid/**', route => {
        requests.push(route.request().url());
        return route.abort();
      });
      const opener = page.getByRole('button', { name: dark ? '첨부 파일 preview-sample.md 열기' : 'Open attachment preview-sample.md' });
      await opener.click();
      const dialog = page.getByRole('dialog', { name: 'preview-sample.md', exact: true });
      const raw = dialog.getByRole('button', { name: dark ? '원본 보기' : 'Raw View' });
      const rendered = dialog.getByRole('button', { name: dark ? 'MD 보기' : 'MD View' });
      const text = dialog.locator('.focused-text');
      await expect(raw).toHaveAttribute('aria-pressed', 'true');
      await expect(text).toHaveJSProperty('textContent', markdown);
      await expect(text.locator('.preview-line').first()).toHaveCSS('counter-increment', 'preview-line 1');
      await expect(text.locator('.preview-token-tag').first()).toHaveText('# Preview notes');
      const search = dialog.getByRole('searchbox');
      const wrap = dialog.locator('.preview-text-controls button[aria-pressed]').last();
      await search.fill('Ready');
      await wrap.click();
      await rendered.click();
      await expect(rendered).toHaveAttribute('aria-pressed', 'true');
      await expect(text).toBeHidden();
      const doc = dialog.getByRole('region', { name: dark ? 'MD 보기' : 'MD View' });
      await expect(doc.getByRole('heading', { level: 1 })).toHaveText('Preview notes');
      expect(await doc.evaluate(node => {
        const size = tag => parseFloat(getComputedStyle(node.querySelector(tag)).fontSize);
        return size('h1') > size('h2') && size('h2') > size('p');
      })).toBe(true);
      await expect(doc.locator('p strong, em, del, p code')).toHaveText(['strong', 'emphasis', 'removed', 'inline_code']);
      await expect(doc.locator('ol')).toHaveAttribute('start', '3');
      await expect(doc.locator('ul ul li')).toHaveText('Nested item');
      const boxes = doc.getByRole('checkbox');
      await expect(boxes.nth(0)).toBeDisabled();
      await expect(boxes.nth(0)).toBeChecked();
      await expect(boxes.nth(1)).toBeDisabled();
      await expect(boxes.nth(1)).not.toBeChecked();
      await expect(doc.locator('blockquote')).toHaveText('Quoted text');
      await expect(doc.getByRole('separator')).toBeVisible();
      const table = doc.getByRole('table').first();
      await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Status']);
      await expect(table.getByRole('cell')).toHaveText(['Widget', 'Ready']);
      await expect(doc.locator('pre code').nth(0)).toHaveText('const answer = 42; // highlighted');
      await expect(doc.locator('pre code').nth(1)).toHaveText('let plain = 3 < 4;');
      await expect(doc.locator('pre .preview-token-keyword')).toHaveText('const');
      await expect(doc.locator('a, img, script, iframe, object, embed')).toHaveCount(0);
      await expect(doc).toContainText('<script>window.markdownScriptRan = true</script>');
      await expect(doc).toContainText('Remote image');
      await expect(doc).toContainText('Local image');
      expect(await page.evaluate(() => window.markdownScriptRan)).toBeUndefined();
      expect(requests).toEqual([]);
      await expect(doc).toHaveCSS('background-color', dark ? 'rgb(17, 18, 20)' : 'rgb(255, 255, 255)');
      const end = doc.getByRole('heading', { name: 'End of document' });
      await end.scrollIntoViewIfNeeded();
      expect(await doc.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      await doc.evaluate(node => { node.scrollTop = 0; });
      await info.attach('markdown-preview', { body: await dialog.screenshot(), contentType: 'image/png' });
      await page.setViewportSize({ width: 640, height: 760 });
      for (const scroller of [doc.locator('.preview-markdown-table').last(), doc.locator('pre').last()]) {
        await scroller.scrollIntoViewIfNeeded();
        expect(await scroller.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        expect(await scroller.evaluate(node => {
          const viewport = node.closest('.preview-markdown').getBoundingClientRect();
          const box = node.getBoundingClientRect();
          return box.left >= viewport.left && box.right <= viewport.right;
        })).toBe(true);
      }
      await info.attach('markdown-contained-overflow', { body: await dialog.screenshot(), contentType: 'image/png' });
      await dialog.getByRole('button', { name: dark ? '텍스트 복사' : 'Copy text' }).click();
      await expect.poll(() => page.evaluate(() => window.previewClipboardInput)).toBe(markdown);
      await raw.click();
      await expect(search).toHaveValue('Ready');
      await expect(wrap).toHaveAttribute('aria-pressed', 'false');
      await expect(text).toHaveJSProperty('textContent', markdown);
      expect(await page.evaluate(() => window.markdownPreviewReads)).toBe(1);
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    });
  }

  test('Markdown preview keeps the full source available above the render budget', async ({ page }) => {
    await setup(page);
    await drop(page, ['/fixture/large.md']);
    await page.getByRole('button', { name: 'Open attachment large.md' }).click();
    const dialog = page.getByRole('dialog', { name: 'large.md', exact: true });
    await dialog.getByRole('button', { name: 'MD View' }).click();
    await expect(dialog.getByRole('status')).toContainText('Open Raw View for the complete source.');
    await dialog.getByRole('button', { name: 'Raw View' }).click();
    await expect(dialog.locator('.focused-text')).toHaveJSProperty('textContent', 'x'.repeat(300_000) + '\nLast line  ');
  });

  test('preview guide follows Settings and shares truthful catalog domains', async ({ page }, info) => {
    await ready(page);
    const settings = appTrigger(page, 'settings'), help = appTrigger(page, 'help');
    const left = await settings.boundingBox(), right = await help.boundingBox();
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
    expect(Math.abs(right.y-left.y)).toBeLessThan(4);
    await openAppEntry(page, 'help', 'preview');
    const dialog = page.getByRole('dialog', { name: 'File Preview Guide', exact: true }); await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText(['Supported images', 'Supported text', 'Supported documents',
      'Supported archives', 'Unsupported previews', 'Preview limitations']);
    const formats = await page.evaluate(async () => (await import('/src/hub/previewCatalog.ts')).previewFormats);
    for (const [index, category] of ['image', 'text', 'pdf', 'archive'].entries()) {
      const labels = formats.filter(format => format.category === category)
        .flatMap(({ extensions, filenames }) => [...(extensions ?? []).map(ext => '.' + ext), ...(filenames ?? [])]);
      await expect(dialog.locator('.preview-format-tags').nth(index).locator('li')).toHaveText(labels);
    }
    await expect(dialog).toContainText('RAR and 7Z cannot be previewed');
    await expect(dialog).toContainText('ZIP previews list files, folders, and original file sizes');
    await expect(dialog).toContainText('Attachment eligibility is separate');
    await expect(dialog).toContainText('UTF-8');
    await expect(dialog).toContainText('Switch to MD View for read-only Markdown');
    await expect(dialog).toContainText('JSON View');
    await expect(dialog).toContainText('Record View');
    await expect(dialog).toContainText('GIFs animate in thumbnails and in the focused viewer');
    await expect(dialog).toContainText('without scripts');
    await info.attach('catalog-help', { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(help).toBeFocused();
    await chooseAppPreference(page, 'view', 'theme', 'black');
    await page.keyboard.press('Escape');
    await chooseAppPreference(page, 'settings', 'language', 'ko');
    await page.keyboard.press('Escape');
    await openAppEntry(page, 'help', 'preview');
    const localized = page.getByRole('dialog', { name: '파일 미리 보기 안내', exact: true });
    await expect(localized).toHaveCSS('background-color', 'rgb(17, 18, 20)');
    await expect(localized.getByText('.gitignore', { exact: true })).toBeVisible();
    await expect(localized.getByText('.pdf', { exact: true })).toBeVisible();
    await expect(localized.getByText('.zip', { exact: true })).toBeVisible();
    await expect(localized).toContainText('GIF는 썸네일과 확대 보기에서 재생됩니다.');
    await expect(localized).toContainText('레코드 보기');
    await expect(localized).toContainText('MD 보기에서 읽기 전용으로 표시');
    await info.attach('catalog-korean-black', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
