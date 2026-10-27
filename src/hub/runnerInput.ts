import { msg, HubError } from './i18n';
import type { Terminal } from '@xterm/xterm';

// Runner uses Win32 input mode through ConPTY. Preserve physical Enter and
// Shift+Enter instead of letting a fast text burst become a pasted submission.
export function win32Key(vk: number, unit: number, modifiers = 0, down = true) {
  return `\x1b[${vk};0;${unit};${down ? 1 : 0};${modifiers};1_`;
}

export function win32Text(text: string) {
  return text.replace(/\r\n?/g, '\n').split('').map(char => char === '\n'
    ? win32Key(13, 13, 16) : win32Key(0, char.charCodeAt(0))).join('');
}

// xterm emits query replies and focus reports through onData as well as user
// input. These protocol records never establish a terminal editor draft.
function terminalReply(data: string) {
  return /^\x1b(?:\[(?:[?>]?[\d;]*[cnR]|\??[\d;]+\$y|\d+(?:;\d+)*t|[IO])|\](?:4;\d+|1[012]);rgb:[\da-f]+\/[\da-f]+\/[\da-f]+(?:\x07|\x1b\\))$/i.test(data);
}

export class RunnerInput {
  win32 = false;
  private submission?: string[];
  private readonly disposables;
  constructor(private readonly terminal: Terminal, private readonly send: (text: string) => void,
    changed: () => void, private readonly userInput: () => boolean = () => true) {
    this.disposables = [
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
      terminal.onData(data => {
        if (this.submission) { this.submission.push(data); return; }
        if (terminalReply(data)) { send(data); return; }
        if (!this.userInput()) return;
        if (!this.win32) { send(data); return; }
        if (data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~')) {
          send(win32Text(data.slice(6, -6)));
        } else {
          // Terminal replies retain their protocol bytes; IME text uses UTF-16 key records.
          send(data.startsWith('\x1b') ? data : win32Text(data));
        }
      }),
    ];
    terminal.attachCustomKeyEventHandler(event => {
      if (!this.win32 || event.isComposing || event.metaKey || event.key === 'Process' || event.key === 'Dead') return true;
      if (event.type === 'keypress') return false;
      if (event.type !== 'keydown' && event.type !== 'keyup') return true;
      // Let the browser/xterm own clipboard shortcuts and selected-text copying.
      if (event.ctrlKey && (event.key.toLowerCase() === 'v'
        || event.key.toLowerCase() === 'c' && (event.shiftKey || terminal.hasSelection()))) return true;
      if (!this.userInput()) { event.preventDefault(); return false; }
      const characters: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27 };
      const control = event.ctrlKey ? 8 : 0;
      const modifiers = control | (event.altKey ? 2 : 0) | (event.shiftKey ? 16 : 0);
      let unit = characters[event.key] ?? (event.key.length === 1 ? event.key.charCodeAt(0) : 0);
      if (control && event.key.length === 1 && /[a-z]/i.test(event.key)) unit = event.key.toUpperCase().charCodeAt(0) & 31;
      send(win32Key(event.keyCode, unit, modifiers, event.type === 'keydown'));
      event.preventDefault();
      return false;
    });
  }
  get canSubmit() { return this.win32 || this.terminal.modes.bracketedPasteMode; }
  submit(text: string) {
    if (!this.canSubmit) throw new HubError(msg('runtime.input.waiting'));
    if (this.win32) this.send(win32Text(text) + win32Key(13, 13));
    else {
      this.submission = [];
      let pasted: string;
      try { this.terminal.paste(text); pasted = this.submission.join(''); }
      finally { this.submission = undefined; }
      this.send(pasted + '\r');
    }
  }
  dispose() { this.disposables.forEach(value => value.dispose()); }
}
