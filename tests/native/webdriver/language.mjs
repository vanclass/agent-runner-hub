import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';

// Independent readiness and assertion ownership; only existing React DOM handlers.
export const languageCase = defineNativeCase({
  id: 'language-preference', presentation: 'nonactivating',
  async ready(browser) {
    await browser.waitUntil(async () => browser.execute(() =>
      document.readyState === 'complete' && !!document.querySelector('.app-settings[open] .language-picker select')),
    { timeout: browser.options.waitforTimeout, timeoutMsg: 'Language selection is not ready' });
  },
  async run(browser) {
    const initial = await browser.execute(() => ({
      selected: document.querySelector('.app-settings .language-picker select').value,
      saved: localStorage.getItem('agent-runner-hub.preferences.v1')
    }));
    assert.equal(initial.saved, null, 'Every case must start with a fresh profile');
    await browser.execute(() => {
      const select = document.querySelector('.app-settings .language-picker select');
      const next = select.value === 'ko' ? 'en' : 'ko';
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, next);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => browser.execute(() => {
      const value = document.querySelector('.app-settings .language-picker select').value;
      return JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1'))?.language === value;
    }), { timeout: browser.options.waitforTimeout });
    const changed = await languageState(browser);
    assert.notEqual(changed.selected, initial.selected);
    assert.equal(changed.persisted, changed.selected);
    assert.equal(changed.documentLanguage, changed.selected);
    return { initial, changed };
  },
  async observe(browser) {
    const state = await languageState(browser);
    assert.equal(state.persisted, state.selected);
    assert.equal(state.documentLanguage, state.selected);
    assert.ok(state.label.length);
    return state;
  }
});
function languageState(browser) {
  return browser.execute(() => ({
    selected: document.querySelector('.app-settings .language-picker select').value,
    persisted: JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1'))?.language,
    documentLanguage: document.documentElement.lang,
    label: document.querySelector('.app-settings .language-picker span').textContent
  }));
}