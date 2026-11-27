export class HubLogs {
  constructor(dom, settings) {
    this.dom = dom;
    this.settings = settings;
  }

  async history() {
    // The native read also enforces retention. Use the product's current policy.
    const retentionDays = (await this.settings.saved())?.hubLogRetentionDays ?? 30;
    return this.dom.browser.execute(retentionDays => window.__TAURI_INTERNALS__.invoke('hub_log',
      { request: { retentionDays, event: null } }), retentionDays);
  }

  rows() {
    return this.dom.browser.execute(() => Array.from(document.querySelectorAll('.hub-log-row'), row => ({
      sequence: Number(row.dataset.sequence), text: row.textContent
    })));
  }

  scroll(position) {
    return this.dom.scroll('.hub-log-records', position);
  }

  async scrollToBottom() {
    const viewport = await this.dom.state('.hub-log-records');
    if (!viewport) throw new Error('Single Entry log viewport unavailable');
    return this.scroll({ top: viewport.scroll.height });
  }
}
