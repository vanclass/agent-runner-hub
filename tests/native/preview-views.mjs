import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import { PNG } from 'pngjs';
import { nativeSuite } from '../../tools/native-probe/suite.mjs';
import { defineNativeCase, UnverifiedObservation } from '../../tools/native-probe/case.mjs';
import { readyInstalledHub, visibleConnection } from './webdriver/runner-flow.mjs';
import { generatedSource, animatedFixture, injectGeneratedImage, animationFrames } from './webdriver/attachment-preview.mjs';
import { HubActions } from './webdriver/hub-actions.mjs';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerRoot = process.env.HUB_RUNNER_ACCEPTANCE_ROOT;
const formats = JSON.parse(readFileSync(new URL('../../src-tauri/src/preview_formats.json', import.meta.url), 'utf8'));
const directory = path.join(root, 'temp/preview-originals', randomUUID());
await fs.mkdir(directory, { recursive: true });
const image = path.join(directory, 'selected-image.png');
const pdf = path.join(root, 'src-tauri/test-fixtures/preview-sample.pdf');
const brokenPdf = path.join(directory, 'malformed.pdf');
const zip = path.join(root, 'src-tauri/test-fixtures/preview-sample.zip');
const brokenZip = path.join(directory, 'malformed.zip');
await fs.writeFile(brokenZip, 'invalid ZIP');
await fs.writeFile(brokenPdf, '%PDF-1.4\ninvalid');
await fs.writeFile(image, PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640*320*4,180) }));
const imageFiles = ['sample.jpg', 'sample.jpeg', 'sample.webp', 'sample.bmp', 'sample.ico', 'animated.gif', 'static.svg']
  .map(name => path.join(directory, name));
for (const file of imageFiles) {
  const name = path.basename(file).replace(/\.jpeg$/, '.jpg');
  await fs.copyFile(path.join(root, 'src-tauri/test-fixtures/preview-images', name), file);
}
const original = '첫 줄\n  둘째 줄\t{"value":42}\n';
const markdown = await fs.readFile(path.join(root, 'src-tauri/test-fixtures/preview-sample.md'), 'utf8');
const jsonOriginals = new Map([
  ['original.json', '\uFEFF {"value":900719925474099312345,"value":-0}\r\n'],
  ['original.jsonl', '{"first":true}\r\n{"bad":}\r\n[null]\r\n'],
]);
const files = ['original.txt','original.md',...jsonOriginals.keys(),'original.ts','Dockerfile','.gitignore']
  .map(name => path.join(directory, name));
const textFixture = name => name === 'original.md' ? markdown : jsonOriginals.get(name) ?? original;
for (const file of files) await fs.writeFile(file, textFixture(path.basename(file)), 'utf8');
after(async () => {
  for (const file of [image, brokenPdf, brokenZip, ...imageFiles, ...files]) await fs.unlink(file);
  await fs.rmdir(directory);
  await fs.rmdir(path.dirname(directory)).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
});
const background = process.env.HUB_PREVIEW_BACKGROUND_ONLY === '1';
async function exerciseImages(browser, hub, surface) {
  const { attachments } = hub, { viewer } = attachments;
  const results = [];
  for (const file of imageFiles) {
    const gif = file.endsWith('.gif'), svg = file.endsWith('.svg'), width = gif ? 2 : 16;
    await attachments.dropPaths(surface, [file]);
    await hub.wait(async () => (await attachments.inventory(surface))?.items[0]?.thumbnail?.width === width, 'Native thumbnail did not load: ' + file);
    assert.equal((await attachments.inventory(surface)).items[0].path, file);
    await attachments.openPreview(surface, 0);
    await hub.wait(async () => (await viewer.state())?.image?.naturalWidth === width, 'Native focused image did not load: ' + file);
    if (svg) {
      const png = await browser.execute(async () => {
        const response = await fetch(document.querySelector('.focused-image-viewport img').src);
        return { mime: response.headers.get('content-type'), bytes: [...new Uint8Array(await response.arrayBuffer())] };
      });
      assert.equal(png.mime, 'image/png');
      assert.deepEqual(PNG.sync.read(Buffer.from(png.bytes)).data, Buffer.from(Array.from({ length: 128 }, () => [255, 0, 0, 255]).flat()));
    }
    await viewer.close();
    await hub.wait(async () => !await viewer.state(), 'Native focused image did not close');
    await attachments.remove(surface, 0);
    await hub.wait(async () => (await attachments.inventory(surface))?.items.length === 0, 'Native image attachment did not retire');
    results.push({ name: path.basename(file), width });
  }
  return results;
}

async function observeLocalGif(browser, hub, surface) {
  const { attachments } = hub, { viewer } = attachments;
  await attachments.dropPaths(surface, [imageFiles.find(file => file.endsWith('.gif'))]);
  await hub.wait(async () => (await attachments.inventory(surface))?.items[0]?.thumbnail?.width === 2,
    'Animated GIF thumbnail did not load');
  const thumbnail = await animationFrames(browser, '.attachment-chip img[alt="animated.gif"]');
  await attachments.openPreview(surface, 0);
  await hub.wait(async () => (await viewer.state())?.image?.naturalWidth === 2,
    'Animated GIF viewer did not load');
  return { thumbnail, focused: await animationFrames(browser, '.focused-image-viewport img') };
}
async function exerciseArchive(browser, hub, surface, index) {
  const { attachments } = hub;
  const original = await fs.readFile(zip);
  await attachments.dropPaths(surface, [zip, brokenZip]);
  await hub.wait(async () => (await attachments.inventory(surface))?.items.length === index + 2,
    'Native drop did not stage both ZIP paths');
  await browser.execute(path => {
    [...document.querySelectorAll('.attachment-open')].find(button => button.title === path).focus();
  }, zip);
  await attachments.openPreview(surface, index);
  await hub.wait(async () => await browser.execute(() => Boolean(document.querySelector('.archive-scroll'))),
    'Native ZIP preview did not load');
  await hub.dom.click('.archive-scroll > ul > li:nth-child(2) > details > summary');
  await hub.dom.click('.archive-scroll details[open] ul summary');
  assert.deepEqual(await browser.execute(() => {
    const row = [...document.querySelectorAll('.archive-file')].find(row => row.querySelector('bdi').textContent === 'notes.txt');
    const nested = row.closest('details'), folder = nested.parentElement.closest('details');
    return [folder.open, nested.open, row.querySelector('.archive-size').textContent];
  }), [true, true, '1.5 KiB']);
  await hub.dom.click('.archive-toolbar button');
  await hub.wait(async () => !await attachments.viewer.state(), 'Native ZIP preview did not close');
  assert.equal(await browser.execute(() => document.activeElement?.title), zip);
  await attachments.openPreview(surface, index + 1);
  await hub.wait(async () => await browser.execute(() =>
    document.querySelector('.focused-viewer[open] [role="status"]')?.textContent.includes('It remains attached')),
  'Malformed native ZIP did not show the shared failure');
  await attachments.viewer.close();
  assert.deepEqual((await attachments.inventory(surface)).items.slice(index).map(item => item.path), [zip, brokenZip]);
  assert.deepEqual(await fs.readFile(zip), original);
  await attachments.remove(surface, index + 1);
  await attachments.remove(surface, index);
}

const preview = defineNativeCase({
  id: 'preview-views', presentation: background ? 'background' : 'nonactivating',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    const hub = new HubActions(browser);
    const attachments = hub.attachments, viewer = attachments.viewer, surface = 'single-entry';
    const images = await exerciseImages(browser, hub, surface);
    await attachments.dropPaths(surface, [image, ...files, directory]);
    await hub.wait(async () => (await attachments.inventory(surface))?.items.length === files.length + 2, 'Native drop did not stage paths');
    assert.deepEqual((await attachments.inventory(surface)).items.map(item => item.path), [image, ...files, directory]);
    await attachments.remove(surface, files.length + 1);
    await hub.wait(async () => (await attachments.inventory(surface))?.items.length === files.length + 1, 'Folder card did not retire');
    const texts = [];
    for (const [index, file] of files.entries()) {
      await attachments.openPreview(surface, index + 1);
      await hub.wait(async () => (await viewer.state())?.text != null, 'Local text preview did not load');
      const name = path.basename(file);
      const expected = textFixture(name);
      assert.equal((await viewer.state()).text, expected);
      const modes = '.focused-viewer[open] .preview-text-modes';
      if (jsonOriginals.has(name)) {
        await hub.dom.click(modes + ' button:last-child');
        const values = await browser.execute(() => {
          const content = document.querySelector('.focused-viewer[open] .preview-json');
          return {
            numbers: [...content.querySelectorAll('.preview-json-number')].map(node => node.textContent),
            lines: [...content.querySelectorAll('.preview-json-line')].map(node => node.textContent),
            errors: content.querySelectorAll('.preview-json-error').length
          };
        });
        assert.deepEqual(values, name === 'original.json'
          ? { numbers: ['900719925474099312345', '-0'], lines: [], errors: 0 }
          : { numbers: [], lines: ['Line 1', 'Line 2', 'Line 3'], errors: 1 });
        await hub.dom.click(modes + ' button:first-child');
        assert.equal((await viewer.state()).text, expected);
      } else if (name === 'original.md') {
        await hub.dom.click(modes + ' button:last-child');
        const rendered = await browser.execute(() => {
          const doc = document.querySelector('.focused-viewer[open] .preview-markdown');
          return {
            heading: doc.querySelector('h1').textContent,
            cells: [...doc.querySelectorAll('td')].map(cell => cell.textContent),
            tasks: [...doc.querySelectorAll('input:disabled')].map(input => input.checked),
            activeResources: doc.querySelectorAll('script, img, a, iframe').length,
          };
        });
        assert.deepEqual(rendered, { heading: 'Preview notes', cells: ['Widget', 'Ready'], tasks: [true, false], activeResources: 0 });
        await hub.dom.click(modes + ' button:first-child');
        assert.equal((await viewer.state()).text, expected);
        assert.equal(await fs.readFile(file, 'utf8'), expected);
      } else {
        assert.equal(await browser.execute(selector => Boolean(document.querySelector(selector)), modes), false);
      }
      texts.push({ name, original: true, structured: name === 'original.md' || jsonOriginals.has(name) });
      await viewer.close();
      await hub.wait(async () => !await viewer.state(), 'Local text preview did not close');
    }
    await attachments.dropPaths(surface, [pdf, brokenPdf]);
    await attachments.openPreview(surface, files.length + 1);
    await hub.wait(async () => await browser.execute(() =>
      Boolean(document.querySelector('[data-page="1"] canvas[data-rendered]'))), 'Native PDF did not render');
    const renderedPdf = await browser.execute(() => {
      const canvas = document.querySelector('[data-page="1"] canvas');
      const sample = canvas.getContext('2d').getImageData(Math.round(canvas.width / 2),
        Math.round(canvas.height * 95 / 720), 1, 1).data;
      return { pixel: [...sample], toolbar: document.querySelector('.pdf-toolbar').textContent };
    });
    assert.deepEqual(renderedPdf.pixel, [33, 79, 166, 255]);
    assert.match(renderedPdf.toolbar, /preview-sample\.pdf.*of 4/);
    await hub.dom.click('.pdf-toolbar [aria-label="Next page"]');
    await hub.wait(async () => await browser.execute(() =>
      document.querySelector('.pdf-toolbar input')?.value === '2'), 'Native PDF did not navigate');
    await viewer.close();
    await attachments.openPreview(surface, files.length + 2);
    await hub.wait(async () => await browser.execute(() =>
      document.querySelector('.focused-viewer[open] [role="status"]')?.textContent.includes('It remains attached')),
    'Malformed native PDF did not show the shared failure');
    await viewer.close();
    assert.equal((await attachments.inventory(surface)).items.length, files.length + 3);
    await attachments.remove(surface, files.length + 2);
    await attachments.remove(surface, files.length + 1);
    await exerciseArchive(browser, hub, surface, files.length + 1);
    await hub.settings.openMenu('help');
    await hub.dom.click('[data-menu-item="preview"]');
    const help = await browser.execute(() => {
      const guide = document.querySelector('.preview-help[open]');
      const bounds = guide.getBoundingClientRect();
      return { text: guide.textContent,
        tags: [...guide.querySelectorAll('.preview-format-tags')].map(list => [...list.children].map(tag => tag.textContent)),
        contained: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight };
    });
    assert.deepEqual(help.tags, ['image', 'text', 'pdf', 'archive'].map(category => formats.filter(format => format.category === category)
      .flatMap(({ extensions, filenames }) => [...(extensions ?? []).map(ext => '.' + ext), ...(filenames ?? [])])));
    assert.match(help.text, /Attachment eligibility is separate/);
    assert.ok(help.contained);
    await hub.dom.click('.preview-help .settings-close');
    assert.ok(await browser.execute(() => document.activeElement?.matches('[data-menu-trigger="help"], [data-menu-trigger="compact"]')));
    await attachments.openPreview(surface, 0);
    await hub.wait(async () => (await viewer.state())?.image?.naturalWidth === 640, 'Local image preview did not load');
    await viewer.zoom(-300);
    await hub.wait(async () => (await viewer.state())?.image?.scale > 1, 'Image preview did not zoom');
    await viewer.zoom(300);
    await hub.wait(async () => Math.abs((await viewer.state())?.image?.scale - 1) < 0.001, 'Image preview did not return to baseline');
    const state = await viewer.state();
    assert.equal(state.name, 'selected-image.png');
    assert.equal(state.buttons, 0);
    assert.equal((await attachments.inventory(surface)).items.length, files.length + 1);
    return { images, texts, renderedPdf, help, state, method: 'Actual native filesystem IPC and production DOM consumer; scripted drop and clicks',
      physicalGestures: 'unverified; browser gesture evidence is separate' };
  },
  async observe(browser) {
    const state = await browser.execute(() => {
      const dialog=document.querySelector('.focused-viewer[open]'), img=dialog.querySelector('img'), r=img.getBoundingClientRect(), d=dialog.getBoundingClientRect();
      return { visibility:document.visibilityState, width:r.width,height:r.height, contained:r.left>=d.left&&r.right<=d.right&&r.top>=d.top&&r.bottom<=d.bottom,
        backdrop:getComputedStyle(dialog,'::backdrop').backgroundColor,title:dialog.querySelector('header').textContent };
    });
    assert.equal(state.visibility,'visible');assert.ok(state.contained);assert.equal(state.width/state.height,2);assert.equal(state.title,'selected-image.png');
    const hub = new HubActions(browser);
    await hub.attachments.viewer.close();
    await hub.wait(async () => !await hub.attachments.viewer.state(), 'Native PNG viewer did not close');
    for (let index = files.length; index >= 0; index--) {
      await hub.attachments.remove('single-entry', index);
      await hub.wait(async () => (await hub.attachments.inventory('single-entry'))?.items.length === index,
        'Previous preview attachment did not retire');
    }
    const animation = await observeLocalGif(browser, hub, 'single-entry');
    return { state, animation };
  }
});
const runnerPreview = defineNativeCase({
  id: 'runner-local-images', presentation: background ? 'background' : 'nonactivating',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    const hub = new HubActions(browser);
    await hub.addRunner();
    await visibleConnection(browser, runnerRoot);
    return exerciseImages(browser, hub, 'runner');
  },
  observe: browser => observeLocalGif(browser, new HubActions(browser), 'runner'),
});
const generated = defineNativeCase({
  id: 'generated-consumer', presentation: background ? 'background' : 'nonactivating',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    // A larger fixture keeps inline centers measurable at fractional display scaling.
    const fixture = animatedFixture(await fs.readFile(path.join(root, 'src-tauri/test-fixtures/preview-images/generated-animation.gif')));
    await injectGeneratedImage(browser, fixture);
    const classification = 'Synthetic image IPC only; no genuine Codex generation provenance';
    if (!background) return { classification };
    try {
      const result = await generatedSource(browser);
      assert.equal(result.outcome, 'supported', JSON.stringify(result));
      return { classification, result };
    } finally { await browser.execute(() => window.__restoreGeneratedFixture()); }
  },
  async observe(browser) {
    try {
      const result = await generatedSource(browser, { observeAnimation: true });
      assert.equal(result.outcome, 'supported', JSON.stringify(result));
      return result;
    } finally { await browser.execute(() => window.__restoreGeneratedFixture()); }
  }
});
const genuineGenerated = defineNativeCase({
  id: 'genuine-generated-consumer', presentation: 'background',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    const result = await generatedSource(browser);
    if (result.outcome !== 'supported') throw new UnverifiedObservation(JSON.stringify(result));
    return result;
  }
});
nativeSuite(background ? [preview, runnerPreview, generated] : process.env.GENERATED_GIF_ONLY === '1' ? [generated]
  : [preview, runnerPreview, generated, genuineGenerated],
  { root, target: process.env.CARGO_TARGET_DIR || path.join(root,'local/hub-native/target') });
