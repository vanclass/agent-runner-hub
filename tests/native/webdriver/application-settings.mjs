const dialog = '.app-settings[open]:not(.shortcut-settings)';
const controls = {
  language: '.language-picker select',
  confirmRemoval: '.removal-preference input',
  allocationPolicy: '.domain-preference[title] select',
  domainDisplay: '.domain-preference:not([title]) select',
  retentionDays: 'input[type="number"]'
};
const shortcutControls = {
  assign: '.shortcut-row:nth-of-type(1) button',
  entry: '.shortcut-row:nth-of-type(2) button',
  runner: '.shortcut-row:nth-of-type(3) button'
};

export class ApplicationSettings {
  constructor(dom) {
    this.dom = dom;
    this.browser = dom.browser;
  }

  async open() {
    if (!await this.dom.state(dialog)) await this.dom.click('.app-settings-trigger');
  }

  close() {
    return this.dom.click(dialog + ' .settings-close');
  }

  field(name) {
    return this.dom.state(dialog + ' ' + controls[name]);
  }

  async edit(name, value) {
    const selector = dialog + ' ' + controls[name];
    if (name === 'confirmRemoval') {
      const state = await this.dom.state(selector);
      if (!state) throw new Error('Removal preference unavailable');
      if (state.checked !== value) await this.dom.click(selector);
      return;
    }
    await this.dom.changeValue(selector, String(value));
    if (name === 'retentionDays') await this.dom.dispatch(selector, 'focusout');
  }

  setTheme(theme) {
    if (!['light', 'black'].includes(theme)) throw new TypeError('Unknown Hub theme');
    return this.dom.click(dialog + ' .theme-picker button:has(.theme-dot.' + theme + ')');
  }

  appearance() {
    return this.browser.execute(() => ({
      theme: document.querySelector('.hub')?.dataset.theme ?? null,
      language: document.documentElement.lang,
      languageLabel: document.querySelector('.app-settings .language-picker span')?.textContent ?? null,
      themePressed: document.querySelector('.theme-picker button[aria-pressed="true"] .theme-dot')?.classList[1] ?? null
    }));
  }

  saved() {
    return this.browser.execute(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')));
  }

  async savedTab(id) {
    return (await this.saved())?.runnerSelections?.[id] ?? null;
  }

  openShortcuts() {
    return this.dom.click(dialog + ' .shortcut-settings-trigger');
  }

  async captureShortcut(action, key, modifiers = {}) {
    if (!Object.hasOwn(shortcutControls, action)) throw new TypeError('Unknown shortcut action');
    const selector = '.shortcut-settings[open] ' + shortcutControls[action];
    await this.dom.click(selector);
    await this.dom.key(selector, key, modifiers);
  }

  shortcutIssue() {
    return this.dom.state('.shortcut-settings[open] [role="alert"]');
  }

  saveShortcuts() {
    return this.dom.click('.shortcut-settings[open] .composer-actions button:last-child');
  }
}
