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
await fs.writeFile(image, PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640*320*4,180) }));
const imageFiles = ['sample.jpg', 'sample.jpeg', 'sample.webp', 'sample.bmp', 'sample.ico', 'animated.gif', 'static.svg']
  .map(name => path.join(directory, name));
for (const file of imageFiles) {
  const name = path.basename(file).replace(/\.jpeg$/, '.jpg');
  await fs.copyFile(path.join(root, 'src-tauri/test-fixtures/preview-images', name), file);
}
const original = '첫 줄\n  둘째 줄\t{"value":42}\n';
const files = ['original.txt','original.md','original.json','original.ts','Dockerfile','.gitignore']
  .map(name => path.join(directory, name));
for (const file of files) await fs.writeFile(file, original, 'utf8');
after(async () => {
  for (const file of [image, ...imageFiles, ...files]) await fs.unlink(file);
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
      assert.equal((await viewer.state()).text, original);
      texts.push({ name: path.basename(file), original: true });
      await viewer.close();
      await hub.wait(async () => !await viewer.state(), 'Local text preview did not close');
    }
    await hub.settings.openMenu('help');
    await hub.dom.click('[data-menu-item="preview"]');
    const help = await browser.execute(() => {
      const guide = document.querySelector('.preview-help[open]');
      const bounds = guide.getBoundingClientRect();
      return { text: guide.textContent,
        tags: [...guide.querySelectorAll('.preview-format-tags')].map(list => [...list.children].map(tag => tag.textContent)),
        contained: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight };
    });
    assert.deepEqual(help.tags, ['image', 'text'].map(category => formats.filter(format => format.category === category)
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
    return { images, texts, help, state, method: 'Actual native filesystem IPC and production DOM consumer; scripted drop and clicks',
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
