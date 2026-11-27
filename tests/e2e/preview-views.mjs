import { appTrigger, chooseAppPreference, openAppEntry } from './application-menu.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { imageBackdrop, registerOrdinaryBackdrops } from './dialog-backdrops.mjs';
import { HubActions } from '../native/webdriver/hub-actions.mjs';
import { testBrowser } from './test-browser.mjs';
import { animationFrames, animatedFixture } from '../native/webdriver/attachment-preview.mjs';
const png = [...PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640 * 320 * 4, 180) })];
const pdf = readFileSync(new URL('../../src-tauri/test-fixtures/preview-sample.pdf', import.meta.url)).toString('base64');
const original = '  첫 번째 줄\n# 원문 <script>window.previewExecuted=true</script>\n{"값": "한글"}\n  ';
const source = '\tconst start = "Find.Me";\r\n' + '// 공백 유지\r\n'.repeat(64)
  + 'const end = "find.me"; // ' + 'long line '.repeat(30) + '\r\n  ';

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
  async function setup(page, entry = false) {
    await ready(page);
    await page.evaluate(({ png, gif, original, source, pdf }) => {
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
        if (/\.(txt|md|json)$/.test(args.path) && !args.path.includes('missing')) return { kind: 'text', path: args.path, text: original };
        if (args.path.endsWith('.ts')) return { kind: 'text', path: args.path, text: source };
        if (args.path.endsWith('/.gitignore') || args.path.endsWith('.log')) return { kind: 'text', path: args.path, text: '  # exact\n/dist/\n' };
        return { kind: 'unavailable', path: args.path, reason: 'unsupported' };
      };
    }, { png, gif: animatedFixture().bytes, original, source, pdf });
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
    await info.attach('catalog-korean-black', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
