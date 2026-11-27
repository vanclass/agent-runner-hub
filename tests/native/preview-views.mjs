import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import { PNG } from 'pngjs';
import { nativeSuite } from '../../tools/native-probe/suite.mjs';
import { defineNativeCase, UnverifiedObservation } from '../../tools/native-probe/case.mjs';
import { readyInstalledHub } from './webdriver/runner-flow.mjs';
import { generatedSource, animatedFixture, injectGeneratedImage } from './webdriver/attachment-preview.mjs';
import { HubActions } from './webdriver/hub-actions.mjs';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerRoot = process.env.HUB_RUNNER_ACCEPTANCE_ROOT;
const formats = JSON.parse(readFileSync(new URL('../../src-tauri/src/preview_formats.json', import.meta.url), 'utf8'));
const directory = path.join(root, 'temp/preview-originals', randomUUID());
await fs.mkdir(directory, { recursive: true });
const image = path.join(directory, 'selected-image.png');
await fs.writeFile(image, PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640*320*4,180) }));
const original = '첫 줄\n  둘째 줄\t{"value":42}\n';
const files = ['original.txt','original.md','original.json','original.ts','Dockerfile','.gitignore']
  .map(name => path.join(directory, name));
for (const file of files) await fs.writeFile(file, original, 'utf8');
after(async () => {
  for (const file of [image,...files]) await fs.unlink(file);
  await fs.rmdir(directory);
  await fs.rmdir(path.dirname(directory)).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
});
const background = process.env.HUB_PREVIEW_BACKGROUND_ONLY === '1';
const preview = defineNativeCase({
  id: 'preview-views', presentation: background ? 'background' : 'nonactivating',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    const hub = new HubActions(browser);
    const attachments = hub.attachments, viewer = attachments.viewer, surface = 'single-entry';
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
    return { texts, help, state, method: 'Actual native filesystem IPC and production DOM consumer; scripted drop and clicks',
      physicalGestures: 'unverified; browser gesture evidence is separate' };
  },
  async observe(browser) {
    const state = await browser.execute(() => {
      const dialog=document.querySelector('.focused-viewer[open]'), img=dialog.querySelector('img'), r=img.getBoundingClientRect(), d=dialog.getBoundingClientRect();
      return { visibility:document.visibilityState, width:r.width,height:r.height, contained:r.left>=d.left&&r.right<=d.right&&r.top>=d.top&&r.bottom<=d.bottom,
        backdrop:getComputedStyle(dialog,'::backdrop').backgroundColor,title:dialog.querySelector('header').textContent };
    });
    assert.equal(state.visibility,'visible');assert.ok(state.contained);assert.equal(state.width/state.height,2);assert.equal(state.title,'selected-image.png');
    return state;
  }
});
const generated = defineNativeCase({
  id: 'generated-consumer', presentation: background ? 'background' : 'nonactivating',
  ready: browser => readyInstalledHub(browser, runnerRoot),
  async run(browser) {
    const fixture = animatedFixture();
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
nativeSuite(background ? [preview, generated] : process.env.GENERATED_GIF_ONLY === '1' ? [generated] : [preview, generated, genuineGenerated],
  { root, target: process.env.CARGO_TARGET_DIR || path.join(root,'local/hub-native/target') });
