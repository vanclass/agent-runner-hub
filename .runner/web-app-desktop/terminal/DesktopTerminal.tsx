import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { openPty, type Pty, type PtyExit, type PtyRequest } from './bridge';

export function DesktopTerminal({ request, onExit }: {
  request?: Omit<PtyRequest, 'cols' | 'rows'>; onExit?: (event: PtyExit) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const search = useRef<SearchAddon | null>(null);
  const [status, setStatus] = useState('Starting terminal');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let exited = false;
    let pty: Pty | undefined;
    const pendingInput: Uint8Array[] = [];
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const terminal = new Terminal({ cursorBlink: true });
    const fit = new FitAddon();
    const find = new SearchAddon();
    search.current = find;
    terminal.loadAddon(fit);
    terminal.loadAddon(find);
    terminal.open(container.current);
    fit.fit();
    const failed = (reason: unknown) => { if (!disposed) setStatus(String(reason)); };
    const write = (bytes: Uint8Array) => {
      if (pty) void pty.write(bytes).catch(failed); else pendingInput.push(bytes);
    };
    const send = terminal.onData(text => write(new TextEncoder().encode(text)));
    const binary = terminal.onBinary(text => {
      write(Uint8Array.from(text, char => char.charCodeAt(0)));
    });
    const resized = terminal.onResize(({ cols, rows }) => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (pty) void pty.resize(cols, rows).catch(failed); }, 30);
    });
    const observer = new ResizeObserver(() => { if (!disposed) fit.fit(); });
    observer.observe(container.current);
    void openPty({ ...request, cols: terminal.cols, rows: terminal.rows }, (bytes, consumed) => {
      if (disposed) consumed(); else terminal.write(bytes, consumed);
    }, event => {
      exited = true;
      if (!disposed) { setStatus(event.error || `Exited (${event.code ?? 'unknown'})`); onExit?.(event); }
    }, failed).then(async value => {
      if (disposed) { await value.close(); return; }
      pty = value;
      for (const bytes of pendingInput.splice(0)) await value.write(bytes);
      if (!exited) await value.resize(terminal.cols, terminal.rows);
      if (!disposed && !exited) setStatus('Terminal running');
    }).catch(failed);
    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      send.dispose(); binary.dispose(); resized.dispose();
      search.current = null;
      void pty?.close().catch(reason => console.error('Terminal cleanup failed', reason));
      terminal.dispose();
    };
  }, [request, onExit]);
  return <section aria-label="Desktop terminal">
    <div role="status">{status}</div>
    <label>Search <input value={query} onChange={event => setQuery(event.target.value)} /></label>
    <button onClick={() => search.current?.findPrevious(query)}>Previous</button>
    <button onClick={() => search.current?.findNext(query)}>Next</button>
    <div ref={container} style={{ height: 320, width: '100%', textAlign: 'left' }} />
  </section>;
}
