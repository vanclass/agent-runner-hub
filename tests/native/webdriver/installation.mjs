import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { readyHub } from './probe.mjs';
import { HubActions } from './hub-actions.mjs';

export const installationEntry = defineNativeCase({
  id: 'installation-entry', presentation: 'background', ready: readyHub,
  async run(browser) {
    const hub = new HubActions(browser);
    const before = await browser.execute(() => ({ native: !!window.__TAURI_INTERNALS__,
      saved: localStorage.getItem('agent-runner-hub.installation'),
      disabled: document.querySelector('.installation-verify').disabled }));
    assert.deepEqual(before, { native: true, saved: null, disabled: true });
    await hub.installationPath('relative-not-an-installation');
    const state = await hub.verifyInstallation(browser.options.waitforTimeout);
    const rejected = { message: state.rejection, setupOpen: state.open, saved: state.saved,
      retryEnabled: !(await hub.dom.state('.installation-verify')).disabled,
      runners: await browser.execute(() => document.querySelectorAll('.runner-row').length) };
    assert.match(rejected.message, /absolute path/i);
    assert.equal(rejected.setupOpen, true);
    assert.equal(rejected.saved, null);
    assert.equal(rejected.retryEnabled, true);
    assert.equal(rejected.runners, 0);
    return { method: 'actual Tauri installation UI and native resolver rejection', before, rejected,
      runnerAuthentication: 'not exercised', workAdmission: 'not exercised', workStart: 'not exercised' };
  }
});
