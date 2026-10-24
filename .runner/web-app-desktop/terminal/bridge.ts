import { Channel, invoke } from '@tauri-apps/api/core';

export type PtyRequest = {
  program?: string; args?: string[]; cwd?: string; env?: Record<string, string>;
  cols: number; rows: number;
};
export type PtyExit = { id: string; code: number | null; error: string | null };
type PtyEvent = ({ type: 'output'; id: string; sequence: number; bytes: number[] })
  | ({ type: 'exit' } & PtyExit);
export type Pty = {
  id: string;
  write(bytes: Uint8Array): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  close(): Promise<void>;
};

export async function openPty(request: PtyRequest, output: (bytes: Uint8Array, consumed: () => void) => void,
  exit: (event: PtyExit) => void, error: (reason: unknown) => void): Promise<Pty> {
  let exited = false;
  const channel = new Channel<PtyEvent>();
  channel.onmessage = event => {
    if (event.type === 'exit') { exited = true; exit(event); return; }
    // Acknowledge after xterm consumes this batch; the Rust reader bounds queued output.
    try { output(new Uint8Array(event.bytes), () => {
      void invoke('pty_ack', { id: event.id, sequence: event.sequence }).catch(error);
    }); } catch (reason) {
      error(reason);
      void invoke('pty_close', { id: event.id }).catch(error);
    }
  };
  const id = await invoke<string>('pty_open', { request, onEvent: channel });
  let input: Promise<void> = Promise.resolve();
  let closed: Promise<void> | undefined;
  return { id,
    write(bytes) {
      const sent = input.then(() => invoke<void>('pty_write', { id, bytes: Array.from(bytes) }));
      input = sent.catch(() => {});
      return sent;
    },
    resize: (cols, rows) => exited ? Promise.resolve() : invoke('pty_resize', { id, cols, rows }),
    close: () => closed ||= exited ? Promise.resolve() : invoke('pty_close', { id }),
  };
}
