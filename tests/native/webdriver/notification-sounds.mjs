
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { HubActions } from './hub-actions.mjs';
import { commandMs } from '../../../tools/native-probe/limits.mjs';
import { readyInstalledHub, visibleConnection, stopWatching } from './runner-flow.mjs';
import { mountedRunner } from './mounted-runner.mjs';

const defaults = ['user-request.wav', 'work-completed.wav', 'work-interrupted.wav'];
const added = 'Extra chime.WAV';

const list = browser => browser.execute(() => window.__TAURI_INTERNALS__.invoke('list_notification_sounds'));

async function prepareSoundFiles(browser, profile) {
  await browser.waitUntil(() => browser.execute(() => !!window.__TAURI_INTERNALS__?.invoke
    && document.readyState === 'complete'));
  const folder = path.join(profile, 'notification-sounds');
  const seed = await Promise.all(defaults.map(name => fs.readFile(path.join(folder, name))));
  assert.equal(new Set(seed.map(bytes => bytes.toString('base64'))).size, defaults.length);
  assert.deepEqual((await list(browser)).sort(), [...defaults].sort());
  await fs.writeFile(path.join(folder, added), seed[0], { flag: 'wx' });
  await fs.writeFile(path.join(folder, 'notes.txt'), 'excluded', { flag: 'wx' });
}

export const notificationSoundsCase = defineNativeCase({
  id: 'notification-sounds',
  presentation: 'background',
  ready: (browser, { profile }) => prepareSoundFiles(browser, profile),
  async run(browser) {
    const files = (await list(browser)).sort();
    assert.deepEqual(files, [added, ...defaults].sort());
    const playback = await browser.execute(playNativeFile, added);
    assert.ok(playback.duration > 0 && playback.elapsed >= playback.duration && playback.state === 'running');
    return { files, playback, audibleOutput: 'not exercised (muted graph)' };
  },
});

export const notificationSoundEventsCase = runnerRoot => defineNativeCase({
  id: 'notification-sound-events',
  presentation: 'background',
  async ready(browser, { profile }) {
    await readyInstalledHub(browser, runnerRoot);
    await prepareSoundFiles(browser, profile);
  },
  async run(browser) {
    const files = (await list(browser)).sort();
    assert.deepEqual(files, [added, ...defaults].sort());
    const playback = await exerciseHubPlayback(browser, runnerRoot).finally(() => stopWatching(browser));
    assert.ok(playback.duration > 0 && playback.elapsed >= playback.duration && playback.state === 'running',
      'Event playback must run through the full sound buffer');
    return { files, playback, eventSource: 'simulated Work observation in the mounted Runner', selector: 'preview and cancel',
      audibleOutput: 'not exercised (muted graph)' };
  },
});

async function exerciseHubPlayback(browser, runnerRoot) {
  const hub = new HubActions(browser);
  await hub.addRunner();
  const { session, generation } = await visibleConnection(browser, runnerRoot);
  await browser.execute(observePlayback);
  assert.equal(await browser.execute(() => !!document.querySelector('.notification-sound-selector[open]')), false,
    'The selector must be closed before the first Work event');
  assert.equal(await mountedRunner(browser, 'notification-probe', { session, generation }), true);
  const playback = index => browser.execute(i => window.notificationProbe.playbacks[i], index);
  await hub.wait(() => playback(0), 'Event sound did not finish in the WebView', commandMs);
  const evidence = await playback(0);

  await hub.settings.openMenu('settings');
  await hub.dom.click('[data-menu-item="notification-sounds"]');
  await hub.dom.click('[data-menu-item="workCompleted"]');
  const dialog = '.notification-sound-selector[open]';
  const findOption = () => browser.execute(name => {
    const options = [...document.querySelectorAll('.notification-sound-selector[open] [role="option"]')];
    return options.findIndex(row => row.textContent === name) + 1;
  }, added);
  await hub.wait(() => findOption(), 'Native selector did not list the added sound', commandMs);
  const option = await findOption();
  await hub.dom.click(`${dialog} [role="option"]:nth-child(${option})`);
  await hub.wait(() => playback(1), 'Selector preview did not finish in the WebView', commandMs);
  await hub.dom.click(dialog + ' button[type="button"]:first-of-type');
  await hub.wait(() => browser.execute(() => !document.querySelector('.notification-sound-selector[open]')),
    'Cancel did not close the selector', commandMs);
  assert.equal(await browser.execute(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1') ?? '{}')
    .notificationSounds?.workCompleted ?? null), null);
  return evidence;
}

function observePlayback() {
  const playbacks = [];
  window.notificationProbe = { playbacks };
  const prototype = AudioBufferSourceNode.prototype;
  const start = prototype.start;
  prototype.start = function (...args) {
    const context = this.context, started = context.currentTime, duration = this.buffer.duration;
    const activated = navigator.userActivation.hasBeenActive;
    const mute = context.createGain();
    mute.gain.value = 0;
    this.disconnect();
    this.connect(mute).connect(context.destination);
    this.addEventListener('ended', () => {
      playbacks.push({ duration, elapsed: context.currentTime - started, state: context.state, activated });
    }, { once: true });
    return start.apply(this, args);
  };
}

async function playNativeFile(name) {
  const bytes = await window.__TAURI_INTERNALS__.invoke('read_notification_sound', { name });
  const audio = new AudioContext();
  const elapsed = audio.currentTime;
  let timeout;
  const run = async () => {
    const buffer = await audio.decodeAudioData(bytes);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const silentOutput = audio.createGain();
    silentOutput.gain.value = 0;
    source.connect(silentOutput).connect(audio.destination);
    await audio.resume();
    await new Promise(resolve => { source.onended = resolve; source.start(); });
    return { duration: buffer.duration, elapsed: audio.currentTime - elapsed, state: audio.state };
  };
  try {
    return await Promise.race([run(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('WebView playback did not settle')), 5_000);
    })]);
  } finally {
    clearTimeout(timeout);
    await audio.close();
  }
}
