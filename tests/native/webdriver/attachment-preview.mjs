import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ownedConnection, correlated } from './runner-flow.mjs';

const digest = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
async function rendered(browser) {
  return browser.execute(() => {
    const host = document.querySelector('.focused-viewer[open] .focused-image-viewport');
    const image = host.querySelector('img'), bounds = image.getBoundingClientRect();
    const frame = document.querySelector('.focused-viewer[open]').getBoundingClientRect();
    return { source: image.src, width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      contained: bounds.left >= frame.left && bounds.right <= frame.right && bounds.top >= frame.top && bounds.bottom <= frame.bottom,
      scale: Number(host.dataset.scale), panX: Number(host.dataset.x), panY: Number(host.dataset.y) };
  });
}
async function open(browser) {
  await browser.execute(() => document.querySelector('.generated-image-preview').click());
  await browser.waitUntil(() => browser.execute(() => !!document.querySelector('.focused-viewer[open] img')?.naturalWidth));
}

// Uses only the original owning session, production selection/refresh and verified Blob.
// interact is feature-test input, never a production hook or permission to issue native input.
export async function generatedSource(browser, interact) {
  const existing = await ownedConnection(browser);
  const before = await browser.execute(() => Object.keys(window.__wg3Observation.snapshots));
  await browser.execute(() => document.querySelector('.add-runner').click());
  let created;
  await browser.waitUntil(async () => {
    created = await browser.execute(before => Object.keys(window.__wg3Observation.snapshots)
      .filter(id => !before.includes(id)), before);
    return created.length === 1 && browser.execute(() => !!document.querySelector('.generated-images'));
  });
  assert.equal(created.length, 1, 'Bind only the session created by this New Runner action');
  const connection = await ownedConnection(browser, existing.snapshot.features.runnerRoot, created[0]);
  let inventory;
  try {
    inventory = await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_images_list', { id }), connection.session);
  } catch (error) {
    return { outcome: 'unavailable', reason: String(error.message), method: 'Existing owned authenticated list; no generation' };
  }
  if (!inventory.images.length) return { outcome: 'unavailable',
    reason: 'Authenticated owned-session list has no genuine generated image', incomplete: inventory.incomplete };
  const image = inventory.images[0];
  const verified = await browser.execute(args => window.__TAURI_INTERNALS__.invoke('runner_image_read', args),
    { id: connection.session, imageId: image.imageId });
  assert.deepEqual(verified.image, image);
  assert.equal(verified.png.length, image.byteLength);
  assert.equal(digest(verified.png), image.sha256);
  const current = await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session);
  correlated(current, connection);
  // Promotion mounts the consumer before its first asynchronous discovery settles.
  await browser.waitUntil(() => browser.execute(imageId =>
    [...document.querySelectorAll('.generated-images select option')].some(option => option.value === imageId),
  image.imageId)).catch(() => {});
  const selection = await browser.execute(imageId => {
    const section = document.querySelector('.generated-images'), select = section?.querySelector('select');
    if (!select || ![...select.options].some(option => option.value === imageId))
      return { available: false, reason: section?.textContent || 'Production generated consumer unavailable' };
    select.value = imageId; select.dispatchEvent(new Event('change', { bubbles: true }));
    return { available: true };
  }, image.imageId);
  if (!selection.available) return { outcome: 'unavailable', reason: selection.reason,
    retrieved: { imageId: image.imageId, sha256: image.sha256 }, properties: { R04: 'unverified', R05: 'unverified', R06: 'unverified' } };
  await browser.waitUntil(() => browser.execute(() => {
    const refresh = document.querySelector('.generated-images-toolbar button');
    return refresh && !refresh.disabled;
  }));
  await browser.execute(() => document.querySelector('.generated-images-toolbar button').click());
  await browser.waitUntil(() => browser.execute(() => {
    const section = document.querySelector('.generated-images');
    return section?.dataset.state === 'available' && !!section.querySelector('.generated-image-preview img')?.naturalWidth;
  }));
  const preview = await browser.execute(async () => {
    const image = document.querySelector('.generated-image-preview img');
    return { source: image.src, bytes: [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())] };
  });
  assert.equal(digest(preview.bytes), image.sha256, 'Production Blob must match the authenticated item');
  await open(browser);
  const initial = await rendered(browser);
  assert.equal(initial.source, preview.source);
  assert.equal(initial.naturalWidth, image.width); assert.equal(initial.naturalHeight, image.height);
  assert.ok(initial.width > 0 && initial.height > 0 && initial.contained);
  assert.ok(Math.abs(initial.width / initial.height - image.width / image.height) < 0.01);
  const header = await browser.execute(() => ({
    name: document.querySelector('.focused-viewer[open] header')?.textContent ?? null,
    buttons: document.querySelectorAll('.focused-viewer[open] button').length
  }));
  // The current allowlisted GeneratedImage protocol has no trustworthy name field.
  assert.equal(header.name, null); assert.equal(header.buttons, 0);
  const result = { outcome: 'supported', image: { imageId: image.imageId, sha256: image.sha256,
    width: image.width, height: image.height }, initial, header,
    properties: { R04: 'supported', R05: { header: 'supported', escape: 'unverified' }, R06: 'unverified' },
    method: 'Existing owning-connection list/read to production RunnerImagePreviews/FocusedViewer; no generation' };
  if (!interact) {
    result.interactionLimit = 'No authorized input adapter: Escape, wheel and pan remain unverified';
    await browser.execute(() => document.querySelector('.focused-viewer[open]').close());
    return result;
  }
  await interact.wheel(-350);
  await browser.waitUntil(async () => (await rendered(browser)).width > initial.width);
  const zoomed = await rendered(browser);
  await interact.pan();
  await browser.waitUntil(async () => (await rendered(browser)).panX > zoomed.panX);
  const panned = await rendered(browser);
  assert.ok(panned.x > zoomed.x && panned.y > zoomed.y);
  await interact.wheel(350);
  await browser.waitUntil(async () => (await rendered(browser)).width < zoomed.width);
  const reduced = await rendered(browser);
  for (const state of [zoomed, panned, reduced]) {
    assert.equal(state.source, initial.source);
    assert.ok(Math.abs(state.width / state.height - image.width / image.height) < 0.01);
  }
  await interact.escape();
  await browser.waitUntil(() => browser.execute(() => !document.querySelector('.focused-viewer[open]')));
  await open(browser);
  const reset = await rendered(browser);
  assert.equal(reset.scale, 1); assert.equal(reset.panX, 0); assert.equal(reset.panY, 0);
  assert.equal(reset.source, initial.source);
  await interact.escape();
  await browser.waitUntil(() => browser.execute(() => !document.querySelector('.focused-viewer[open]')));
  assert.equal(await browser.execute(() => !!document.querySelector('textarea[data-instruction]')), true);
  correlated(await browser.execute(id => window.__TAURI_INTERNALS__.invoke('runner_observe', { id }), connection.session), connection);
  result.properties.R05.escape = 'supported'; result.properties.R06 = 'supported';
  result.gestures = { zoomed, panned, reduced, reset };
  return result;
}
