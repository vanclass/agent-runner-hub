const setup = '.installation-setup[open]';
const shield = '.application-menu-shield';
const item = id => `[data-menu-item="${id}"]`;
const entries = {
  language: ['settings', 'language'],
  confirmRemoval: ['runner', 'removal'],
  allocationPolicy: ['runner', 'allocation'],
  domainDisplay: ['view', 'domain'],
  retentionDays: ['settings', 'retention'],
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

  async openMenu(group) {
    const compact = '[data-menu-trigger="compact"]';
    if ((await this.dom.state(compact))?.rect.width) {
      await this.dom.click(compact);
      await this.dom.click(item(group));
    } else await this.dom.click(`[data-menu-trigger="${group}"]`);
  }

  async field(name) {
    if (await this.dom.state(setup)) return this.dom.state(setup + ' .language-picker select');
    const [group, id] = entries[name];
    await this.openMenu(group);
    if (name !== 'confirmRemoval') await this.dom.click(item(id));
    const state = await this.browser.execute((id, name) => {
      if (name === 'confirmRemoval') {
        return { checked: document.querySelector(`[data-menu-item="${id}"]`)?.getAttribute('aria-checked') === 'true' };
      }
      return { value: name === 'retentionDays' ? document.querySelector('#retention-days')?.value
        : document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.dataset.menuItem };
    }, id, name);
    await this.dom.click(shield);
    return state;
  }

  async edit(name, value) {
    if (await this.dom.state(setup)) {
      await this.dom.changeValue(setup + ' .language-picker select', String(value));
      return;
    }
    const [group, id] = entries[name];
    await this.openMenu(group);
    if (name === 'confirmRemoval') {
      const checked = await this.browser.execute(() => document.querySelector('[data-menu-item="removal"]')
        ?.getAttribute('aria-checked') === 'true');
      if (checked !== value) await this.dom.click(item(id));
    } else {
      await this.dom.click(item(id));
      if (name === 'retentionDays') {
        await this.dom.changeValue('#retention-days', String(value));
        await this.dom.click('.retention-actions button[type="submit"]');
      } else await this.dom.click(item(value));
    }
    await this.dom.click(shield);
  }

  async setTheme(theme) {
    if (!['light', 'black'].includes(theme)) throw new TypeError('Unknown Hub theme');
    if (await this.dom.state(setup)) {
      await this.dom.click(setup + ' .theme-picker button:has(.theme-dot.' + theme + ')');
      return;
    }
    await this.openMenu('view');
    await this.dom.click(item('theme'));
    await this.dom.click(item(theme));
    await this.dom.click(shield);
  }

  appearance() {
    return this.browser.execute(() => ({
      theme: document.querySelector('.hub')?.dataset.theme ?? null,
      language: document.documentElement.lang,
      languageLabel: document.querySelector('.installation-setup .language-picker span')?.textContent ?? null,
      themePressed: document.querySelector('.theme-picker button[aria-pressed="true"] .theme-dot')?.classList[1] ?? null
    }));
  }

  saved() {
    return this.browser.execute(() => JSON.parse(localStorage.getItem('agent-runner-hub.preferences.v1')));
  }

  async savedTab(id) {
    return (await this.saved())?.runnerSelections?.[id] ?? null;
  }

  async openShortcuts() {
    await this.openMenu('settings');
    await this.dom.click(item('shortcuts'));
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
