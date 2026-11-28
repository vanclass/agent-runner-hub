
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';

const defaults = ['user-request.wav', 'work-completed.wav', 'work-interrupted.wav'];
const added = 'Extra chime.WAV';

const list = browser => browser.execute(() => window.__TAURI_INTERNALS__.invoke('list_notification_sounds'));

export const notificationSoundsCase = defineNativeCase({
  id: 'notification-sounds',
  presentation: 'background',
  async ready(browser, { profile }) {
    await browser.waitUntil(() => browser.execute(() => !!window.__TAURI_INTERNALS__?.invoke
      && document.readyState === 'complete'));
    const folder = path.join(profile, 'notification-sounds');
    const seed = await Promise.all(defaults.map(name => fs.readFile(path.join(folder, name))));
    assert.equal(new Set(seed.map(bytes => bytes.toString('base64'))).size, defaults.length);
    assert.deepEqual((await list(browser)).sort(), [...defaults].sort());
    await fs.writeFile(path.join(folder, added), seed[0], { flag: 'wx' });
    await fs.writeFile(path.join(folder, 'notes.txt'), 'excluded', { flag: 'wx' });
  },
  async run(browser) {
    const files = (await list(browser)).sort();
    assert.deepEqual(files, [added, ...defaults].sort());
    const playback = await browser.execute(async name => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const bytes = await invoke('read_notification_sound', { name });
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
    }, added);
    assert.ok(playback.duration > 0 && playback.elapsed >= playback.duration && playback.state === 'running');
    return { files, playback, audibleOutput: 'not exercised (muted graph)' };
  },
});
