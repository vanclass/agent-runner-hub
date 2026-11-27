import { BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';
import { Dom } from '../../../tools/native-probe/dom.mjs';
import { startupMs } from '../../../tools/native-probe/limits.mjs';
import { ComposerAttachments, instructionSelector } from './composer-attachments.mjs';
import { GeneratedImages } from './generated-images.mjs';

const configuration = {
  account: ['.account-settings select', JSON.parse, JSON.stringify],
  mode: ['.execution-settings label:first-of-type select', JSON.parse, JSON.stringify],
  target: ['.execution-settings label:nth-of-type(2) select', JSON.parse, JSON.stringify],
  model: ['.model-settings label:nth-of-type(1) select', JSON.parse, JSON.stringify],
  reasoning: ['.model-settings label:nth-of-type(2) select', String, String],
  fast: ['.model-settings .fast-option input'],
  directRoot: ['.execution-settings .directory-input input']
};

export class HubActions {
  constructor(browser) {
    this.browser = browser;
    this.dom = new Dom(browser);
    this.attachments = new ComposerAttachments(this.dom);
    this.images = new GeneratedImages(this.dom);
  }

  wait(predicate, timeoutMsg, timeout = startupMs) {
    return this.browser.waitUntil(predicate, { timeout, timeoutMsg });
  }

  async openConfiguration() {
    if (await this.dom.state('.task-panel.collapsed')) await this.dom.click('.task-panel-toggle');
  }

  installationPath(location) {
    return this.dom.changeValue('.runner-location input', location);
  }

  installationState() {
    return this.browser.execute(() => ({
      saved: localStorage.getItem('agent-runner-hub.installation'),
      open: !!document.querySelector('.app-settings[open]'),
      pending: document.querySelector('.runner-location')?.getAttribute('aria-busy') === 'true',
      verified: !!document.querySelector('.installation-success'),
      rejection: document.querySelector('.runner-location [role="alert"]')?.textContent ?? null
    }));
  }

  async verifyInstallation(timeout = startupMs) {
    await this.dom.click('.installation-verify');
    let state;
    await this.wait(async () => {
      state = await this.installationState();
      return !state.pending && (!state.open || state.verified || state.rejection);
    }, 'Installation UI did not settle', timeout);
    return state;
  }

  selectSingleEntry() {
    return this.dom.click('.sidebar .single-entry');
  }

  activeRunner() {
    return this.browser.execute(() => document.querySelector('.runner-row.active')?.dataset.runnerId ?? null);
  }

  async addRunner() {
    const prior = await this.activeRunner();
    await this.dom.click('.add-runner');
    let id;
    await this.wait(async () => {
      id = await this.activeRunner();
      return id && id !== prior;
    }, 'Added Runner tab did not become active');
    return id;
  }

  async selectRunner(id) {
    const escaped = await this.browser.execute(value => CSS.escape(value), id);
    await this.dom.click('.runner-row[data-runner-id=' + escaped + '] .nav-row');
    await this.wait(async () => await this.activeRunner() === id, 'Runner tab did not become active');
  }

  async field(name) {
    const [suffix, decode] = configuration[name];
    const state = await this.dom.state('.task-panel ' + suffix);
    if (!state) return null;
    const parse = value => decode && value ? decode(value) : value || null;
    return { ...state, value: name === 'fast' ? state.checked : parse(state.value),
      options: state.options?.map(option => ({ ...option, value: parse(option.value) })) ?? null };
  }

  async providerLabels() {
    return this.browser.execute(() => Array.from(
      document.querySelectorAll('.task-panel .account-settings .scope-note'), node => node.textContent));
  }

  async edit(name, value) {
    const [suffix, , encode] = configuration[name];
    const selector = '.task-panel ' + suffix;
    const encoded = value == null ? '' : encode ? encode(value) : value;
    let state;
    await this.wait(async () => {
      state = await this.dom.state(selector);
      return state && !state.disabled && !state.readOnly
        && (!state.options || state.options.some(option => option.value === encoded && !option.disabled));
    }, 'Requested Hub control or option unavailable: ' + name);
    if (name === 'fast') {
      if (state.checked !== value) await this.dom.click(selector);
    } else await this.dom.changeValue(selector, encoded);
  }

  async selectProviderAccount(provider, account) {
    if (account?.agent_id !== provider) throw new TypeError('Account must be qualified by the requested Provider');
    // The panel scopes its choices to the effective Provider. A different startup Provider has no UI switch.
    const current = await this.field('account');
    const accounts = current?.options.filter(option => !option.disabled && option.value) ?? [];
    if (accounts.length && !accounts.some(option => option.value.agent_id === provider)) {
      throw new BlockedPrerequisite('Requested Provider is outside the current Hub account catalog');
    }
    await this.edit('account', account);
  }

  instructionState(surface) {
    return this.dom.state(instructionSelector(surface));
  }

  async draft(surface, text) {
    await this.wait(async () => {
      const state = await this.instructionState(surface);
      return state && !state.disabled && !state.readOnly;
    }, 'Instruction editor unavailable: ' + surface);
    await this.dom.changeValue(instructionSelector(surface), text);
  }

  // Enter submits the current draft, including supported slash commands and /run.
  // Control+Enter uses the application's IssueRun Brief action.
  submit(surface, { brief = false } = {}) {
    return this.dom.key(instructionSelector(surface), 'Enter', { code: 'Enter', ctrlKey: brief });
  }
}
