import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { ApplicationSettings } from './application-settings.mjs';
import { Dom } from '../../../tools/native-probe/dom.mjs';

// Independent readiness and assertion ownership; only existing React DOM handlers.
export const languageCase = (displayed = false) => defineNativeCase({
  id: displayed ? 'language-presentation' : 'language-preference',
  presentation: displayed ? 'nonactivating' : 'background',
  async ready(browser) {
    await browser.waitUntil(async () => browser.execute(() =>
      document.readyState === 'complete' && !!document.querySelector('.app-settings[open] .language-picker select')),
    { timeout: browser.options.waitforTimeout, timeoutMsg: 'Language selection is not ready' });
  },
  async run(browser) {
    const settings = new ApplicationSettings(new Dom(browser));
    const initial = { selected: (await settings.field('language')).value, saved: await settings.saved() };
    assert.equal(initial.saved, null, 'Every case must start with a fresh profile');
    const next = initial.selected === 'ko' ? 'en' : 'ko';
    await settings.edit('language', next);
    await browser.waitUntil(async () => (await settings.saved())?.language === next,
      { timeout: browser.options.waitforTimeout });
    const changed = await languageState(settings);
    assert.notEqual(changed.selected, initial.selected);
    assert.equal(changed.persisted, changed.selected);
    assert.equal(changed.documentLanguage, changed.selected);
    return { initial, changed };
  },
  async observe(browser) {
    const state = await languageState(new ApplicationSettings(new Dom(browser)));
    assert.equal(state.persisted, state.selected);
    assert.equal(state.documentLanguage, state.selected);
    assert.ok(state.label.length);
    return state;
  }
});
async function languageState(settings) {
  const { language, languageLabel } = await settings.appearance();
  return { selected: (await settings.field('language')).value,
    persisted: (await settings.saved())?.language, documentLanguage: language, label: languageLabel };
}
