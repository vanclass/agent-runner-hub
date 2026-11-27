import { PNG } from 'pngjs';
import { HubActions } from '../native/webdriver/hub-actions.mjs';
import { testBrowser } from './test-browser.mjs';
const selected = [...PNG.sync.write({ width: 2, height: 1, data: Buffer.from([255,0,0,255,0,255,0,255]) })];

// Simulated native bytes; Rust exercises actual filesystem/PNG/UTF-8 acquisition separately.
async function reader(page) {
  await page.evaluate(bytes => {
    const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
    const create = URL.createObjectURL.bind(URL);
    window.__localPreview = { reads: [], allocated: [], releases: [] };
    URL.createObjectURL = blob => { const url = create(blob); window.__localPreview.allocated.push(url); return url; };
    native.invoke = async (command, args) => {
      if (command !== 'local_file_preview') return invoke(command, args);
      window.__localPreview.reads.push(args.path);
      if (window.__localPreview.gate) await window.__localPreview.gate;
      return { kind: 'image', path: args.path, base64: btoa(String.fromCharCode(...bytes)) };
    };
  }, selected);
}
export function registerLocalPreviews({ test, expect, ready, paste, requests, drop }) {
  for (const entry of [false, true]) {
    const label = entry ? 'Single Entry' : 'Runner';
    async function setup(page, options) {
      await ready(page, options); await reader(page);
      if (entry) {
        await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
        await page.getByRole('combobox', { name: 'Requested Run Mode', exact: true }).selectOption(JSON.stringify('task-run'));
      }
    }
    test('local preview ' + label + ' exact cancellation, paste identity, original preflight and uncertain/confirmed delivery', async ({ page }, info) => {
      await setup(page, { workMode: 'unknown' });
      const path = '/fixture/selected-original.png';
      await drop(page, [path]); await paste(page, entry ? 'single-entry' : 'runner');
      const image = page.locator('.attachment-chip img').first();
      await expect(image).toHaveJSProperty('naturalWidth', 2);
      await expect(page.locator('.attachment-chip img').nth(1)).toHaveJSProperty('naturalWidth', 1);
      const selectedURL = await image.getAttribute('src');
      const pastedURL = await page.locator('.attachment-chip img').nth(1).getAttribute('src');
      expect(await requests(page)).toEqual([]);
      expect(await image.evaluate(async el => [...new Uint8Array(await (await fetch(el.src)).arrayBuffer())])).toEqual(selected);
      await info.attach('selected-and-pasted-thumbnails', { body: await page.screenshot(), contentType: 'image/png' });
      await drop(page, ['/fixture/cancel.png']);
      const cancelled = page.locator('.attachment-chip').last(), cancelURL = await cancelled.locator('img').getAttribute('src');
      await expect(cancelled.locator('img')).toHaveJSProperty('naturalWidth', 2);
      await new HubActions(testBrowser(page, expect)).attachments.remove(entry ? 'single-entry' : 'runner', 2);
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.revokedUrls)).toContain(cancelURL);
      expect(await page.evaluate(() => window.__nativeFixture.revokedUrls)).not.toContain(selectedURL);
      expect(await page.evaluate(() => window.__nativeFixture.revokedUrls)).not.toContain(pastedURL);
      const input = page.getByRole('textbox', { name: label + ' instructions', exact: true });
      await input.fill('one exact request'); await input.press('Enter');
      if (entry) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      const id = entry ? 'pty-2' : 'pty-1';
      await expect.poll(() => page.evaluate(id => window.__nativeFixture.deliveredSets.filter(x => x.id === id).length, id)).toBe(1);
      expect((await requests(page)).filter(x => x.request.operation === 'references.register').map(x => [x.id,x.request.path]))
        .toEqual([[id,path],[id,expect.stringContaining('/clipboard/session-' + id + '/')]]);
      expect(await page.evaluate(() => window.__nativeFixture.revokedUrls)).not.toContain(selectedURL);
      expect(await page.evaluate(() => window.__nativeFixture.revokedUrls)).not.toContain(pastedURL);
      await expect(page.locator('.attachment-chip img')).toHaveCount(2);
      await page.evaluate(id => { window.__nativeFixture.sessions.get(id).feature.mode = 'started'; }, id);
      if (entry) await page.getByRole('button', { name: 'Single Entry', exact: true }).click();
      await expect(input).toHaveValue('');
      await expect.poll(() => page.evaluate(() => window.__nativeFixture.revokedUrls)).toEqual(expect.arrayContaining([selectedURL,pastedURL,cancelURL]));
      expect(await page.evaluate(id => window.__nativeFixture.deliveredSets.filter(x => x.id === id).length, id)).toBe(1);
      await info.attach('exact-url-lifetimes', { body: JSON.stringify(await page.evaluate(() => ({
        allocated: window.__localPreview.allocated, revoked: window.__nativeFixture.revokedUrls, reads: window.__localPreview.reads }))), contentType: 'application/json' });
    });
    test('local preview ' + label + ' responsive contained tiles', async ({ page }, info) => {
      await setup(page);
      await drop(page, Array.from({ length: 12 }, (_, i) => `/fixture/tile-${i}.png`));
      await expect(page.locator('.attachment-chip img')).toHaveCount(12);
      const columns = [];
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const tiles = await page.locator('.attachment-chip').evaluateAll(items => items.map(item => {
          const box = item.getBoundingClientRect(), image = item.querySelector('img');
          return { x: box.x, y: box.y, width: box.width, imageHeight: image.getBoundingClientRect().height,
            fit: getComputedStyle(image).objectFit, right: box.right };
        }));
        columns.push(tiles.filter(tile => tile.y === tiles[0].y).length);
        for (const tile of tiles) {
          expect(tile.width).toBeCloseTo(144, 0); expect(tile.imageHeight).toBe(120);
          expect(tile.fit).toBe('contain'); expect(tile.right).toBeLessThanOrEqual(width);
        }
        await info.attach(`tiles-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
      expect(columns[0]).toBeLessThan(columns[1]); expect(columns[1]).toBeLessThan(columns[2]);
      await info.attach('responsive-columns', { body: JSON.stringify(columns), contentType: 'application/json' });
    });
    test('local preview ' + label + ' cancellation fences delayed native reads', async ({ page }) => {
      await setup(page);
      await page.evaluate(() => { window.__localPreview.gate = new Promise(resolve => { window.__localPreview.release = resolve; }); });
      await drop(page, ['/fixture/late.png']);
      await expect.poll(() => page.evaluate(() => window.__localPreview.reads)).toContain('/fixture/late.png');
      await new HubActions(testBrowser(page, expect)).attachments.remove(entry ? 'single-entry' : 'runner', 0);
      await page.evaluate(() => { window.__localPreview.gate = undefined; window.__localPreview.release(); });
      // A subsequent read also proves the cancelled read settled before these assertions.
      await drop(page, ['/fixture/current.png']);
      await expect(page.locator('.attachment-chip img')).toHaveJSProperty('naturalWidth', 2);
      expect(await page.evaluate(() => window.__localPreview.allocated.length)).toBe(1);
      expect(await page.evaluate(() => window.__nativeFixture.revokedUrls)).toEqual([]);
      expect(await requests(page)).toEqual([]);
    });
  }
  test('local preview disposal retires exact URLs and fences late results at both production owners', async ({ page }) => {
    await ready(page); await reader(page);
    const result = await page.evaluate(async () => {
      const { RunnerSessions } = await import('/src/hub/RunnerSessions.ts');
      const sessions = new RunnerSessions(), entry = sessions.entry.attachments;
      const { RunnerSession } = await import('/src/hub/RunnerSessions.ts');
      const runner = new RunnerSession({ installationRoot: '/fixture/install' }, () => {});
      const wait = async predicate => { for (let i=0;i<200 && !predicate();i++) await new Promise(r=>setTimeout(r,5)); if(!predicate()) throw Error('preview did not settle'); };
      entry.select(['/fixture/entry.png']); runner.references.select(['/fixture/runner.png']);
      await wait(() => entry.thumbnail(entry.candidates[0]) && runner.references.thumbnail(runner.references.candidates[0]));
      const urls = [entry.thumbnail(entry.candidates[0]),runner.references.thumbnail(runner.references.candidates[0])];
      window.__localPreview.gate = new Promise(resolve => { window.__localPreview.release = resolve; });
      entry.select(['/fixture/entry-late.png']); runner.references.select(['/fixture/runner-late.png']);
      await wait(() => window.__localPreview.reads.length === 4);
      await sessions.dispose(); await runner.dispose();
      const allocatedBefore = [...window.__localPreview.allocated];
      window.__localPreview.gate = undefined; window.__localPreview.release();
      await new Promise(r=>setTimeout(r,20));
      return { urls, allocatedBefore, allocatedAfter: window.__localPreview.allocated,
        revoked: window.__nativeFixture.revokedUrls, empty: [entry.previews.get(1),runner.references.previews.get(1)] };
    });
    expect(result.urls).toHaveLength(2);
    expect(result.revoked).toEqual(expect.arrayContaining(result.urls));
    for (const url of result.urls) expect(result.revoked.filter(x => x === url)).toHaveLength(1);
    expect(result.allocatedAfter).toEqual(result.allocatedBefore);
    expect(result.empty).toEqual([undefined,undefined]);
  });
  test('local preview shared catalog, exact response identity and truthful read failure', async ({ page }) => {
    await ready(page); await reader(page);
    const result = await page.evaluate(async () => {
      const { LocalPreviews } = await import('/src/hub/localPreviews.ts');
      const { previewFormat, previewFormats } = await import('/src/hub/previewCatalog.ts');
      const previews = new LocalPreviews(() => {}), native = window.__TAURI_INTERNALS__;
      const invoke = native.invoke.bind(native);
      native.invoke = async (command, args) => command === 'local_file_preview'
        ? { kind: 'image', path: '/wrong.png', base64: '' } : invoke(command, args);
      previews.load(1,'/right.png');
      while(previews.get(1)?.kind === 'loading') await new Promise(r=>setTimeout(r,5));
      const mismatch = previews.get(1);
      native.invoke = async (command, args) => {
        if (command === 'local_file_preview') throw Error('unreadable');
        return invoke(command, args);
      };
      previews.load(2,'/missing.png');
      while(previews.get(2)?.kind === 'loading') await new Promise(r=>setTimeout(r,5));
      const missing = previews.get(2); previews.dispose();
      const kind = path => previewFormat(path)?.category ?? 'unsupported';
      const declared = previewFormats.flatMap(({ category, extensions, filenames }) =>
        [...(extensions ?? []).map(extension => 'sample.' + extension), ...(filenames ?? [])]
          .map(name => ({ name, category, dispatched: kind('C:\\selected\\' + name.toUpperCase()) })));
      return { mismatch, missing, declared, kinds: ['x.pdf','folder','png','.json','Dockerfile.pdf'].map(kind),
        allocated: window.__localPreview.allocated };
    });
    expect(result.kinds).toEqual(Array(5).fill('unsupported'));
    const textSelectors = ['txt','md','json','c','cpp','h','hpp','cs','py','js','jsx','ts','tsx','rs','java','sql',
      'xml','yaml','yml','toml','ini','cfg','csv','tsv','jsonl','sh','bat','cmd','ps1','html','css','scss','log','diff','patch']
      .map(extension => 'sample.' + extension).concat('Dockerfile', 'Makefile', '.gitignore');
    expect(result.declared.map(entry => entry.name).sort()).toEqual(['sample.png', ...textSelectors].sort());
    for (const entry of result.declared) {
      expect(entry.category).toBe(entry.name === 'sample.png' ? 'image' : 'text');
      expect(entry.dispatched).toBe(entry.category);
    }
    expect(result.mismatch).toEqual({ kind:'unavailable',reason:'unreadable' });
    expect(result.missing).toEqual({ kind:'unavailable',reason:'unreadable' });
    expect(result.allocated).toEqual([]);
    await drop(page, ['/fixture/missing.png']);
    await expect(page.locator('.attachment-open > span')).toHaveText('missing.png');
    await expect(page.locator('.attachment-chip img')).toHaveCount(0);
    expect(await requests(page)).toEqual([]);
  });
}
