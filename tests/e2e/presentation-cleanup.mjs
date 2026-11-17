export function registerPresentationCleanup({ test, expect, transport, configure, create }) {
  for (const operation of ['presentation.subscribe', 'presentation.read', 'presentation.unsubscribe', 'failure', 'read-failure', 'release-failure', 'normal']) {
    for (const dispose of [false, true]) test(`presentation release ${operation} allows ${dispose ? 'dispose' : 'close'}`, async ({ page }) => {
      await transport(page, undefined, { auto: true, work: true }); await page.goto('/');
      const result = await page.evaluate(async ({ operation, dispose }) => {
        const { RunnerSession } = await import('/src/hub/RunnerSessions.ts');
        const native = window.__TAURI_INTERNALS__, original = native.invoke, calls = [];
        let reply;
        native.invoke = async (command, args) => {
          if (command === 'runner_presentation') {
            const op = args.request.operation; calls.push(op);
            if (op === operation) return new Promise(resolve => { reply = resolve; });
            if (operation === 'failure' || operation === 'read-failure' && op === 'presentation.read'
              || operation === 'release-failure' && op === 'presentation.unsubscribe') throw new Error('presentation transport failed');
            if (op === 'presentation.subscribe') return { stream_id: 's', subscription_id: 'u',
              snapshot_sequence: 0, first_sequence: 1, activities: [], closed: false };
            if (op === 'presentation.unsubscribe') return { unsubscribed: true };
            return { stream_id: 's', subscription_id: 'u', events: [], next_sequence: 0,
              through_sequence: 0, caught_up: true, coverage: 'complete', missing_range: null, closed: false };
          }
          if (command === 'pty_close') calls.push(command);
          return original(command, args);
        };
        const session = new RunnerSession({ installationRoot: '/fixture/install' }, () => {});
        await session.open('/fixture/install');
        session.control.presentation.observe('pty-1', true, true, 1, false);
        await new Promise(resolve => setTimeout(resolve, 20));
        const started = performance.now();
        const first = dispose ? session.dispose() : session.closeTab();
        const second = dispose ? session.dispose() : session.closeTab();
        const repeated = first === second;
        const completed = await Promise.race([first.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 2000))]);
        const elapsed = performance.now() - started;
        const closed = calls.includes('pty_close');
        const state = session.control.presentation.state;
        const before = JSON.stringify(state);
        reply?.({ stream_id: 's', subscription_id: 'late', snapshot_sequence: 9,
          first_sequence: 1, activities: [], closed: false });
        await new Promise(resolve => setTimeout(resolve, 20));
        const isolated = before === JSON.stringify(state);
        const order = [...calls];
        await session.dispose(); await session.dispose();
        return { completed, repeated, elapsed, isolated, closed, order };
      }, { operation, dispose });
      expect(result).toMatchObject({ completed: true, repeated: true, isolated: true, closed: true });
      expect(result.elapsed).toBeLessThan(2000);
      if (operation === 'normal') expect(result.order.indexOf('presentation.unsubscribe')).toBeLessThan(result.order.indexOf('pty_close'));
    });
  }
}
