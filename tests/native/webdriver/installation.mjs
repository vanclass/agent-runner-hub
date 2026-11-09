import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { readyHub } from './probe.mjs';
import { changeValue } from './runner-flow.mjs';

export const installationEntry = defineNativeCase({
  id: 'installation-entry', presentation: 'background', ready: readyHub,
  async run(browser) {
    const before = await browser.execute(() => ({ native: !!window.__TAURI_INTERNALS__,
      saved: localStorage.getItem('agent-runner-hub.installation'),
      disabled: document.querySelector('.installation-verify').disabled }));
    assert.deepEqual(before, { native: true, saved: null, disabled: true });
    await changeValue(browser, '.runner-location input', 'relative-not-an-installation');
    await browser.execute(() => document.querySelector('.runner-location').requestSubmit());
    await browser.waitUntil(async () => browser.execute(() =>
      !!document.querySelector('.runner-location [role="alert"]') &&
      document.querySelector('.runner-location').getAttribute('aria-busy') === 'false'),
    { timeout: browser.options.waitforTimeout });
    const rejected = await browser.execute(() => ({
      message: document.querySelector('.runner-location [role="alert"]').textContent,
      setupOpen: !!document.querySelector('.app-settings[open]'),
      saved: localStorage.getItem('agent-runner-hub.installation'),
      retryEnabled: !document.querySelector('.installation-verify').disabled,
      runners: document.querySelectorAll('.runner-row').length }));
    assert.match(rejected.message, /absolute path/i);
    assert.equal(rejected.setupOpen, true);
    assert.equal(rejected.saved, null);
    assert.equal(rejected.retryEnabled, true);
    assert.equal(rejected.runners, 0);
    return { method: 'actual Tauri installation UI and native resolver rejection', before, rejected,
      runnerAuthentication: 'not exercised', workAdmission: 'not exercised', workStart: 'not exercised' };
  }
});
