
import { test, expect } from '../../.project-config/managed/web-app-testing/fixture.mjs';
import { appItem, openAppEntry } from './application-menu.mjs';

const preferenceKey = 'agent-runner-hub.preferences.v1';
const defaults = ['user-request.wav', 'work-completed.wav', 'work-interrupted.wav'];
const categories = ['userRequest', 'workCompleted', 'workInterrupted'];
const existingPreferences = { version: 1, language: 'en', theme: 'light', singleEntry: {}, confirmRunnerRemoval: true };

const openSettings = page => openAppEntry(page, 'settings', 'notification-sounds');
const starts = page => page.evaluate(() => window.audioCalls.filter(call => call.type === 'start').map(call => call.duration));
const selections = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)).notificationSounds, preferenceKey);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, existingPreferences }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(existingPreferences));
    window.audioCalls = [];
    const prototype = AudioBufferSourceNode.prototype;
    const start = prototype.start;
    const stop = prototype.stop;
    prototype.start = function (...args) {
      // Keep sources active until the player stops them, without using the physical audio device as evidence.
      const muted = this.context.createGain();
      muted.gain.value = 0;
      this.disconnect();
      this.connect(muted).connect(this.context.destination);
      this.loop = true;
      start.apply(this, args);
      window.audioCalls.push({ type: 'start', duration: this.buffer.duration });
    };
    prototype.stop = function (...args) {
      stop.apply(this, args);
      window.audioCalls.push({ type: 'stop' });
    };
  }, { key: preferenceKey, existingPreferences });
  await page.goto('/tests/fixtures/hub.html');
  await page.locator('.application-menu').waitFor();
});

test('bundled defaults preview, switch, replay and stop without changing saved choices on dismissal', async ({ page }) => {
  await page.evaluate(() => { window.isTauri = false; });
  await openSettings(page);
  for (const [i, category] of categories.entries()) await expect(appItem(page, category)).toContainText(defaults[i]);
  expect(await selections(page)).toBeUndefined();

  await appItem(page, 'userRequest').click();
  const dialog = page.getByRole('dialog', { name: 'User Request Sound' });
  const list = dialog.getByRole('listbox');
  await expect(list.getByRole('option', { selected: true })).toHaveText(defaults[0]);
  await expect.poll(() => starts(page)).toEqual([]);

  const counts = async () => page.evaluate(() => window.audioCalls.map(call => call.type));
  await list.getByRole('option', { name: defaults[0] }).click();
  await expect.poll(counts).toEqual(['start']);
  await list.getByRole('option', { name: defaults[0] }).click();
  await expect.poll(counts).toEqual(['start', 'stop', 'start']);
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('option', { selected: true })).toHaveText(defaults[1]);
  await expect.poll(counts).toEqual(['start', 'stop', 'start', 'stop', 'start']);
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('option', { selected: true })).toHaveText(defaults[2]);
  await expect.poll(() => starts(page).then(values => new Set(values).size)).toBe(3);

  await list.getByRole('option', { name: 'Silent' }).click();
  await expect.poll(counts).toEqual(['start', 'stop', 'start', 'stop', 'start', 'stop', 'start', 'stop']);
  await page.keyboard.press('ArrowDown');
  await expect.poll(counts).toHaveLength(9);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(counts).toHaveLength(10);
  await expect(appItem(page, 'userRequest')).toBeFocused();
  expect(await selections(page)).toBeUndefined();
});

test('discovery, fixed geometry and category persistence through the Settings menu', async ({ page }) => {
  function installSoundTransport(page, defaults) {
    return page.evaluate(names => {
      const native = window.__TAURI_INTERNALS__;
      const invoke = native.invoke;
      window.soundFiles = [...names];
      window.folderCalls = 0;
      native.invoke = async (command, args, options) => {
        if (command === 'list_notification_sounds') return [...window.soundFiles];
        if (command === 'open_notification_sound_folder') { ++window.folderCalls; return; }
        if (command === 'read_notification_sound') {
          if (args.name === 'Broken.wav') return new ArrayBuffer(8);
          const asset = names.includes(args.name) ? args.name : names[0];
          return fetch('/src-tauri/src/notification_sounds/' + asset).then(response => response.arrayBuffer());
        }
        return invoke(command, args, options);
      };
    }, defaults);
  }

  await installSoundTransport(page, defaults);
  await openSettings(page);
  const rows = page.locator('[data-menu-item]').filter({ has: page.locator('.menu-value') });
  await expect(rows).toHaveText(defaults.map((sound, i) => ['User Request', 'Work Completed', 'Work Interrupted'][i] + sound));
  const positions = () => Promise.all(categories.map(category => appItem(page, category).boundingBox()));
  const originalRows = await positions();
  await appItem(page, 'open-sound-folder').click();
  expect(await page.evaluate(() => window.folderCalls)).toBe(1);

  await appItem(page, 'workCompleted').click();
  const dialog = page.locator('.notification-sound-selector[open]');
  const list = dialog.getByRole('listbox');
  await expect(dialog.getByRole('heading')).toHaveText('Work Completed Sound');
  await expect(list.getByRole('option')).toHaveCount(4);
  const dimensions = () => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const list = element.querySelector('[role=listbox]');
    return { width: bounds.width, height: bounds.height, padding: getComputedStyle(element).padding,
      centered: Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) < 1
        && Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2) < 1,
      listHeight: list.clientHeight + 2, rowHeight: list.firstElementChild.getBoundingClientRect().height,
      outerScroll: element.scrollHeight > element.clientHeight, listScroll: list.scrollHeight > list.clientHeight };
  });
  const geometry = { width: 400, height: 360, padding: '16px', centered: true, listHeight: 240,
    rowHeight: 36, outerScroll: false, listScroll: false };
  expect(await dimensions()).toEqual(geometry);
  expect(await positions()).toEqual(originalRows);
  await list.getByRole('option', { name: 'Silent' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await positions()).toEqual(originalRows);
  expect(await selections(page)).toBeUndefined();

  await page.evaluate(() => window.soundFiles.push('My chime.WAV', 'Broken.wav',
    ...Array.from({ length: 12 }, (_, index) => 'Extra ' + index + '.wav')));
  await page.setViewportSize({ width: 560, height: 440 });
  await appItem(page, 'workCompleted').click();
  await expect(list.getByRole('option', { name: 'My chime.WAV' })).toBeVisible();
  expect(await dimensions()).toEqual({ ...geometry, listScroll: true });
  await list.getByRole('option', { name: 'Broken.wav' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Preview unavailable');
  await list.getByRole('option', { name: 'My chime.WAV' }).click();
  await expect.poll(() => starts(page)).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Select' }).click();
  await expect(dialog).toHaveCount(0);

  await appItem(page, 'workInterrupted').click();
  await list.getByRole('option', { name: 'Silent' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(list.getByRole('option', { selected: true })).toHaveText('Silent');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(await selections(page)).toEqual({ workCompleted: 'My chime.WAV', workInterrupted: null });

  await appItem(page, 'workCompleted').click();
  await list.getByRole('option', { name: 'Silent' }).click();
  await page.mouse.click(10, 10);
  await expect(dialog).toHaveCount(0);
  expect(await selections(page)).toEqual({ workCompleted: 'My chime.WAV', workInterrupted: null });

  await page.reload();
  await openSettings(page);
  await expect(appItem(page, 'userRequest')).toContainText(defaults[0]);
  await expect(appItem(page, 'workCompleted')).toContainText('My chime.WAV');
  await expect(appItem(page, 'workInterrupted')).toContainText('Silent');
});
