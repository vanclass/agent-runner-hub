// Read the actual session-owned xterm; DOM rows contain only the current viewport.
export async function terminalBuffer(browser) {
  return browser.execute(() => {
    const host = document.querySelector('.terminal-host');
    let fiber = host?.[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    for (; fiber; fiber = fiber.return) {
      const session = fiber.memoizedProps?.session;
      if (session?.terminal?.element?.parentElement !== host) continue;
      const terminal = session.terminal, buffer = terminal.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? '');
      return { full: lines.join('\n'), visible: lines.slice(buffer.viewportY, buffer.viewportY + terminal.rows).join('\n'),
        rows: terminal.rows, cols: terminal.cols, length: buffer.length, baseY: buffer.baseY, viewportY: buffer.viewportY,
        identity: { tab: session.view.id, session: session.control.sessionId } };
    }
    throw new Error('Visible session-owned xterm unavailable');
  });
}

// Diagnostic-only subscription: production Hub consumes PTY, never these records.
export async function canonicalRecords(browser, connection) {
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
