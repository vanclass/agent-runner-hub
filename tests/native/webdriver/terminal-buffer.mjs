import { UnverifiedObservation } from '../../../tools/native-probe/case.mjs';
import { mountedRunner } from './mounted-runner.mjs';

export class RunnerTerminal {
  constructor(browser) {
    this.browser = browser;
  }

  buffer() {
    return terminalBuffer(this.browser);
  }

  async find(text, { viewport = false } = {}) {
    const buffer = await this.buffer();
    return (viewport ? buffer.visible : buffer.full).indexOf(text);
  }

  async scroll(position) {
    if (position !== 'top' && position !== 'bottom' && !Number.isInteger(position))
      throw new TypeError('Use top, bottom, or a signed line count');
    const state = await mountedRunner(this.browser, 'scroll', position);
    if (!state) throw new UnverifiedObservation('Mounted session-owned xterm unavailable');
    return state;
  }

  canonicalRecords(connection) {
    return canonicalRecords(this.browser, connection);
  }
}

// Read the actual session-owned xterm; DOM rows contain only the current viewport.
async function terminalBuffer(browser) {
  const buffer = await mountedRunner(browser, 'buffer');
  if (!buffer) throw new UnverifiedObservation('Mounted session-owned xterm unavailable');
  return buffer;
}

// Diagnostic-only subscription: production Hub consumes PTY, never these records.
async function canonicalRecords(browser, connection) {
  return browser.execute(async ({ session, generation }) => {
    const request = request => window.__TAURI_INTERNALS__.invoke('runner_presentation', { id: session, generation, request });
    const sub = await request({ operation: 'presentation.subscribe', api_version: 1, types: ['log', 'activity'] });
    let cursor = 0, text = '', activities = 0;
    try {
      for (let page = 0; page < 100; page++) {
        const result = await request({ operation: 'presentation.read', api_version: 1, subscription_id: sub.subscription_id, after_sequence: cursor });
        if (result.coverage !== 'complete' || result.missing_range) throw new Error('Canonical coverage incomplete');
        for (const event of result.events) {
          if (event.type === 'log') text += event.text + (event.final_fragment && event.terminate_line ? '\n' : '');
          if (event.type === 'activity') activities++;
        }
        cursor = result.next_sequence;
        if (result.caught_up) return { text, activities, sequence: cursor };
      }
      throw new Error('Canonical pagination did not converge');
    } finally {
      await request({ operation: 'presentation.unsubscribe', api_version: 1, subscription_id: sub.subscription_id });
    }
  }, connection);
}
