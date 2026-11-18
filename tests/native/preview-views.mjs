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
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'temp/preview-originals', randomUUID());
await fs.mkdir(directory, { recursive: true });
const image = path.join(directory, 'selected-image.png');
await fs.writeFile(image, PNG.sync.write({ width: 640, height: 320, data: Buffer.alloc(640*320*4,180) }));
const original = '첫 줄\n  둘째 줄\t{"value":42}\n';
const files = ['txt','md','json'].map(ext => path.join(directory, 'original.'+ext));
for (const file of files) await fs.writeFile(file, original, 'utf8');
after(async () => {
  for (const file of [image,...files]) await fs.unlink(file);
  await fs.rmdir(directory);
  await fs.rmdir(path.dirname(directory)).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
});
async function close(browser) {
  await browser.execute(() => document.querySelector('.focused-viewer[open]').close());
  await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.focused-viewer[open]')));
}
async function open(browser, name) {
  await browser.execute(name => [...document.querySelectorAll('.attachment-open')].find(e => e.getAttribute('aria-label') === 'Open attachment '+name).click(), name);
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.focused-viewer[open]')));
}
const preview = defineNativeCase({
  id: 'preview-views', presentation: 'nonactivating',
  ready: browser => readyInstalledHub(browser, 'D:/Codex/codex_workspace'),
  async run(browser) {
    await browser.execute(async paths => {
      const r = document.querySelector('.attachment-composer').getBoundingClientRect();
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', { target: { kind: 'Window', label: 'main' },
        event: 'tauri://drag-drop', payload: { paths, position: { x: (r.x+20)*devicePixelRatio, y: (r.y+20)*devicePixelRatio } } });
    }, [image,...files]);
    const texts = [];
    for (const file of files) {
      await open(browser, path.basename(file));
      await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.focused-text')));
      const text = await browser.execute(() => document.querySelector('.focused-text').textContent);
      assert.equal(text, original); texts.push({ name: path.basename(file), original: true }); await close(browser);
    }
    await browser.execute(() => [...document.querySelectorAll('.hub-preferences button')].find(e => e.textContent === 'Help').click());
    const help = await browser.execute(() => ({ text: document.querySelector('.preview-help[open]').textContent,
      positions: [...document.querySelectorAll('.hub-preferences > button')].map(e=>e.getBoundingClientRect().x) }));
    assert.match(help.text, /\.png/); assert.match(help.text, /\.txt, \.md, \.json/); assert.ok(help.positions[1]>help.positions[0]);
    await close(browser); await open(browser, 'selected-image.png');
    await browser.waitUntil(async () => browser.execute(() => document.querySelector('.focused-image-viewport img')?.naturalWidth === 640));
    const state = await browser.execute(() => ({ title: document.querySelector('.focused-viewer header').textContent,
      buttons: document.querySelectorAll('.focused-viewer[open] button').length, chips: document.querySelectorAll('.attachment-chip').length }));
    assert.deepEqual(state, { title: 'selected-image.png', buttons: 0, chips: 4 });
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
  id: 'generated-consumer', presentation: 'nonactivating',
  ready: browser => readyInstalledHub(browser, 'D:/Codex/codex_workspace'),
  async run(browser) {
    const fixture = animatedFixture();
    await injectGeneratedImage(browser, fixture);
    return { classification: 'Synthetic image IPC only; no genuine Codex generation provenance', fixture };
  },
  async observe(browser) {
    try {
      const result = await generatedSource(browser);
      assert.equal(result.outcome, 'supported', JSON.stringify(result));
      return result;
    } finally { await browser.execute(() => window.__restoreGeneratedFixture()); }
  }
});
const genuineGenerated = defineNativeCase({
  id: 'genuine-generated-consumer', presentation: 'background',
  ready: browser => readyInstalledHub(browser, 'D:/Codex/codex_workspace'),
  async run(browser) {
    const result = await generatedSource(browser);
    throw new UnverifiedObservation(JSON.stringify(result));
  }
});
nativeSuite(process.env.GENERATED_GIF_ONLY === '1' ? [generated] : [preview, generated, genuineGenerated],
  { root, target: process.env.CARGO_TARGET_DIR || path.join(root,'local/hub-native/target') });
