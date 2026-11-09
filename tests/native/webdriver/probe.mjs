import assert from 'node:assert/strict';

// Only DOM operations in the owned real renderer; no fixture page or Runner connection.
export async function observeHub(browser) {
  await browser.waitUntil(async () => browser.execute(() =>
    document.readyState === 'complete' && !!document.querySelector('.app-settings[open] .theme-picker button')),
  { timeout: browser.options.waitforTimeout, timeoutMsg: 'Real Hub installation surface did not become ready' });
  const initial = await browser.execute(() => ({ title: document.title, url: location.href,
    userAgent: navigator.userAgent, tauri: !!window.__TAURI_INTERNALS__,
    setupOpen: !!document.querySelector('.app-settings[open]'),
    theme: document.querySelector('.hub')?.getAttribute('data-theme'),
    savedInstallation: localStorage.getItem('agent-runner-hub.installation') }));
  assert.equal(initial.title, 'AgentRunnerHub');
  assert.match(initial.url, /^https?:\/\/tauri\.localhost\//);
  assert.equal(initial.tauri, true);
  assert.equal(initial.setupOpen, true);
  assert.equal(initial.savedInstallation, null, 'Fresh profile must not contain a Runner installation');
  assert.equal(initial.theme, 'light');
  // Deliberate scripted DOM click avoids the provider's additional el.focus().
  await browser.execute(() => document.querySelectorAll('.app-settings .theme-picker button')[1].click());
  await browser.waitUntil(async () => browser.execute(() => document.querySelector('.hub')?.getAttribute('data-theme') === 'black'),
    { timeout: browser.options.waitforTimeout, timeoutMsg: 'Hub theme did not change through its actual React handler' });
  const changed = await browser.execute(() => ({ theme: document.querySelector('.hub').getAttribute('data-theme'),
    pressed: document.querySelectorAll('.app-settings .theme-picker button')[1].getAttribute('aria-pressed'),
    persistedTheme: JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')).theme }));
  assert.deepEqual(changed, { theme: 'black', pressed: 'true', persistedTheme: 'black' });
  return { initial, changed, interaction: 'scripted DOM click; no physical/native input' };
}
