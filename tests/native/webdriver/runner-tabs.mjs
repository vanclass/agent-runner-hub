import { startupMs } from '../../../tools/native-probe/limits.mjs';

export class RunnerTabs {
  constructor(dom) {
    this.dom = dom;
    this.browser = dom.browser;
  }

  inventory() {
    return this.browser.execute(() => ({
      active: document.querySelector('.runner-row.active')?.dataset.runnerId ?? null,
      singleEntry: !!document.querySelector('.single-entry.active'),
      domains: Array.from(document.querySelectorAll('.runner-domain'), domain => ({
        id: domain.dataset.domain,
        tabs: Array.from(domain.querySelectorAll('.runner-row'), row => ({
          id: row.dataset.runnerId,
          name: row.querySelector('.runner-name')?.textContent ?? row.querySelector('.rename-row input')?.value,
          marker: row.querySelector('.status-dot')?.classList[1] ?? null,
          label: row.querySelector('.status-dot')?.getAttribute('aria-label') ?? null,
          unreadCompletion: !!row.querySelector('.unread-completion')
        }))
      }))
    }));
  }

  active() {
    return this.browser.execute(() => document.querySelector('.runner-row.active')?.dataset.runnerId ?? null);
  }

  selectSingleEntry() {
    return this.dom.click('.sidebar .single-entry');
  }

  async add(domain) {
    const prior = await this.active();
    const scope = domain === undefined ? '.sidebar' : await this.domainSelector(domain);
    await this.dom.click(scope + ' .add-runner');
    let id;
    await this.wait(async () => {
      id = await this.active();
      return id && id !== prior;
    }, 'Added Runner tab did not become active');
    return id;
  }

  async select(id) {
    await this.dom.click(await this.rowSelector(id) + ' .nav-row');
    await this.wait(async () => await this.active() === id, 'Runner tab did not become active');
  }

  async rename(id, name) {
    const row = await this.rowSelector(id);
    await this.dom.click(row + ' .rename-action');
    const input = row + ' .rename-row input';
    await this.dom.changeValue(input, name);
    await this.dom.key(input, 'Enter', { code: 'Enter' });
  }

  async requestRemoval(id) {
    await this.dom.click(await this.rowSelector(id) + ' .remove-action');
  }

  removalPrompt() {
    return this.dom.state('.tab-close-dialog[open] h2');
  }

  confirmRemoval() {
    return this.dom.click('.tab-close-dialog[open] .tab-close-actions button:last-child');
  }

  cancelRemoval() {
    return this.dom.click('.tab-close-dialog[open] .tab-close-actions button:first-child');
  }

  // Use the list's ordinary midpoint-based drop handler, with an optional row anchor.
  async reorder(id, domain, before = null) {
    const source = await this.rowSelector(id);
    const destination = await this.domainSelector(domain) + ' .runner-list';
    const anchor = before === null ? destination : await this.rowSelector(before);
    const { rect } = await this.dom.state(anchor);
    return this.dom.drag(source, destination, { x: rect.x + rect.width / 2, y: before === null ? rect.bottom + 1 : rect.top });
  }

  async navigate(id, key) {
    return this.dom.key(id === null ? '.sidebar .single-entry' : await this.rowSelector(id) + ' .nav-row', key);
  }

  async restartAll() {
    if (!await this.dom.state('.runner-management[open]')) await this.dom.click('.runner-management summary');
    await this.dom.click('.runner-management button');
  }

  restartStatus() {
    return this.browser.execute(() => ({
      pending: document.querySelector('.runner-management button')?.disabled ?? null,
      messages: Array.from(document.querySelectorAll('.restart-status'), node => node.textContent),
      failures: Array.from(document.querySelectorAll('.restart-status[role="alert"]'), node => node.textContent)
    }));
  }

  wait(predicate, timeoutMsg) {
    return this.browser.waitUntil(predicate, { timeout: startupMs, timeoutMsg });
  }

  async rowSelector(id) {
    return '.runner-row[data-runner-id="' + await this.browser.execute(value => CSS.escape(value), id) + '"]';
  }

  async domainSelector(id) {
    return '.runner-domain[data-domain="' + await this.browser.execute(value => CSS.escape(value), id) + '"]';
  }
}
