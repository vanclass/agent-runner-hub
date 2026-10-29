import type { Terminal } from '@xterm/xterm';

export class RunnerInput {
  win32 = false;
  private readonly disposables;
  constructor(private readonly terminal: Terminal, send: (text: string) => void, changed: () => void) {
    // xterm 6's public onData merges user bytes and parser replies. Its origin
    // boundary is required here: filtering bytes would admit protocol-shaped paste,
    // and disableStdin would also suppress required internal query replies.
    const core = (terminal as unknown as { _core: { coreService: {
      triggerDataEvent: (data: string, wasUserInput?: boolean) => void;
    } } })._core.coreService;
    const original = core.triggerDataEvent;
    core.triggerDataEvent = (data, wasUserInput = false) => {
      if (wasUserInput) return;
      send(data);
      original.call(core, data, false);
    };
    this.disposables = [
      { dispose: () => { core.triggerDataEvent = original; } },
      terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
        if (params.includes(9001)) { this.win32 = true; changed(); }
        return params.length === 1 && params[0] === 9001;
      }),
      terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
        if (params.includes(9001)) { this.win32 = false; changed(); }
        return params.length === 1 && params[0] === 9001;
      }),
      terminal.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, params => {
        if (params[0] !== 9001) return false;
        send(`\x1b[?9001;${this.win32 ? 1 : 2}$y`);
        return true;
      }),
    ];
    terminal.attachCustomKeyEventHandler(() => {
      // Returning false leaves browser copy, scrolling and Hub shortcuts available.
      return false;
    });
  }
  get canSubmit() { return this.win32 || this.terminal.modes.bracketedPasteMode; }
  dispose() { this.disposables.forEach(value => value.dispose()); }
}
