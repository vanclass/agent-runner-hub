// Inspect the exact mounted Runner. This is a probe-only renderer dependency.
export function mountedRunner(browser, operation, argument) {
  return browser.execute((operation, argument) => {
    const host = document.querySelector('.terminal-host');
    const tab = document.querySelector('.runner-row.active')?.dataset.runnerId;
    let fiber = host?.[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    for (; fiber; fiber = fiber.return) {
      const session = fiber.memoizedProps?.session;
      const terminal = session?.terminal;
      if (!tab || session?.view?.id !== tab || terminal?.element?.parentElement !== host) continue;
      const identity = { tab, session: session.control.sessionId };
      switch (operation) {
        case 'identity': return identity;
        case 'configuration': return identity.session === argument ? session.control.config.actual : null;
        case 'quick-state': {
          const { control, quick } = session;
          return { fresh: control.observationFresh, controlBusy: control.busy, configActivity: control.config.activity,
            uncertain: control.config.uncertain, recovery: control.recovery.busy, work: control.work.busy,
            assignment: control.assignmentLocked, quick: quick.available, editing: session.hubSelections?.editable,
            loading: session.hubSelections?.loadingOptions, foreground: session.foregroundInteraction,
            lifecycle: control.snapshot.observation?.execution.lifecycle_state };
        }
        case 'state': {
          const view = session.tabView;
          return { identity, process: view.status, activity: view.activity,
            connection: session.control.snapshot.state, fresh: session.control.observationFresh, controlBusy: session.control.busy,
            observation: session.control.snapshot.observation ?? null,
            work: session.control.work.presentedCurrent?.work ?? null };
        }
        case 'scroll': {
          if (argument === 'top') terminal.scrollToTop();
          else if (argument === 'bottom') terminal.scrollToBottom();
          else terminal.scrollLines(argument);
          return { viewportY: terminal.buffer.active.viewportY, baseY: terminal.buffer.active.baseY };
        }
        case 'buffer': {
          const buffer = terminal.buffer.active;
          const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? '');
          const match = typeof argument === 'string' ? lines.findIndex(line => line.includes(argument)) : -1;
          const foreground = match < 0 ? undefined : buffer.getLine(match)?.getCell(lines[match].indexOf(argument))?.getFgColor();
          return { full: lines.join('\n'), visible: lines.slice(buffer.viewportY, buffer.viewportY + terminal.rows).join('\n'),
            rows: terminal.rows, cols: terminal.cols, length: buffer.length, baseY: buffer.baseY, viewportY: buffer.viewportY,
            identity, ...(foreground === undefined ? {} : { foreground }) };
        }
      }
    }
    return null;
  }, operation, argument);
}
