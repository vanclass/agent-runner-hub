import assert from 'node:assert/strict';
import { defineNativeCase } from '../../../tools/native-probe/case.mjs';
import { Dom } from '../../../tools/native-probe/dom.mjs';
import { ApplicationSettings } from './application-settings.mjs';

// Only DOM operations in the owned real renderer; no fixture page or Runner connection.
export async function readyHub(browser) {
  await browser.waitUntil(async () => browser.execute(() =>
    document.readyState === 'complete' && !!document.querySelector('.installation-setup[open] .theme-picker button')),
  { timeout: browser.options.waitforTimeout, timeoutMsg: 'Real Hub installation surface did not become ready' });
}
export async function observeHub(browser) {
  await readyHub(browser);
  const initial = await browser.execute(() => ({ title: document.title, url: location.href,
    userAgent: navigator.userAgent, tauri: !!window.__TAURI_INTERNALS__,
    setupOpen: !!document.querySelector('.installation-setup[open]'),
    theme: document.querySelector('.hub')?.getAttribute('data-theme'),
    savedInstallation: localStorage.getItem('agent-runner-hub.installation') }));
  assert.equal(initial.title, 'AgentRunnerHub');
  assert.match(initial.url, /^(?:https?:\/\/tauri\.localhost|tauri:\/\/localhost)\//);
  assert.equal(initial.tauri, true);
  assert.equal(initial.setupOpen, true);
  assert.equal(initial.savedInstallation, null, 'Fresh profile must not contain a Runner installation');
  assert.equal(initial.theme, 'light');
  const settings = new ApplicationSettings(new Dom(browser));
  await settings.setTheme('black');
  await browser.waitUntil(async () => (await settings.appearance()).theme === 'black',
    { timeout: browser.options.waitforTimeout, timeoutMsg: 'Hub theme did not change through its actual React handler' });
  const { theme, themePressed } = await settings.appearance();
  const changed = { theme, themePressed, persistedTheme: (await settings.saved())?.theme };
  assert.deepEqual(changed, { theme: 'black', themePressed: 'black', persistedTheme: 'black' });
  const activity = await browser.execute(() => {
    const line = document.querySelector('.hub-activity'), previous = line.previousElementSibling;
    return { text: line.textContent, height: line.getBoundingClientRect().height,
      whiteSpace: getComputedStyle(line).whiteSpace, previous: previous.className,
      belowComposer: Math.abs(line.getBoundingClientRect().top - previous.getBoundingClientRect().bottom) < 1,
      composerGap: line.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
      detailedPanels: document.querySelectorAll('.config-evidence, .config-plan, .config-receipt').length };
  });
  assert.ok(Math.abs(activity.composerGap) < 1, JSON.stringify(activity));
  const { composerGap, ...layout } = activity;
  assert.deepEqual(layout, { text: '', height: 22, whiteSpace: 'nowrap', previous: 'composer-area', belowComposer: true, detailedPanels: 0 });
  return { initial, changed, activity, interaction: 'scripted DOM click; no physical/native input' };
}

export const rendererProbe = defineNativeCase({
  id: 'renderer-probe', presentation: 'nonactivating', ready: readyHub, run: observeHub,
  async observe(browser) {
    const state = await browser.execute(() => ({ visibility: document.visibilityState,
      setupOpen: !!document.querySelector('.installation-setup[open]'),
      theme: document.querySelector('.hub')?.getAttribute('data-theme') }));
    assert.equal(state.setupOpen, true);
    assert.equal(state.theme, 'black');
    return state;
  }
});
