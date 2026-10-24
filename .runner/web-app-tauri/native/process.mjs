import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export async function executable(name) {
  const directories = [...(process.env.PATH || '').split(path.delimiter)];
  if (process.env.CARGO_HOME) directories.push(path.join(process.env.CARGO_HOME, 'bin'));
  if (process.env.USERPROFILE) directories.push(path.join(process.env.USERPROFILE, '.cargo/bin'));
  for (const folder of directories) {
    const file = path.join(folder, name + (process.platform === 'win32' ? '.exe' : ''));
    try { if ((await fs.stat(file)).isFile()) return file; } catch { /* Next PATH entry. */ }
  }
  return null;
}

export function command(file, args, cwd, signal, { env = {}, quiet = true, windowsHide = true, windowsVerbatimArguments = false, outputEncoding = 'utf8' } = {}) {
  signal.throwIfAborted();
  if (!file) return Promise.resolve({ code: 1, output: 'Executable is missing.' });
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, shell: false, windowsHide, windowsVerbatimArguments,
      detached: process.platform !== 'win32', env: { ...process.env, ...env },
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let output = '', stdout = '', stderr = '', truncated = false;
    if (quiet) {
      const decoders = { stdout: new StringDecoder(outputEncoding), stderr: new StringDecoder(outputEncoding) };
      const collect = (bytes, stream, end = false) => {
        const text = end ? decoders[stream].end() : decoders[stream].write(bytes);
        output = (output + text).slice(-16384);
        if (stream === 'stdout') { stdout += text; if (stdout.length > 16384) truncated = true; stdout = stdout.slice(-16384); }
        else stderr = (stderr + text).slice(-16384);
      };
      child.stdout.on('data', bytes => collect(bytes, 'stdout'));
      child.stderr.on('data', bytes => collect(bytes, 'stderr'));
      child.stdout.on('end', () => collect(null, 'stdout', true));
      child.stderr.on('end', () => collect(null, 'stderr', true));
    }
    const cancel = () => {
      // Only this freshly spawned process handle and its owned descendants.
      if (child.exitCode !== null || !child.pid) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
          if (error.code !== 'ESRCH') reject(error);
        }
      }
    };
    signal.addEventListener('abort', cancel, { once: true });
    child.once('error', error => {
      signal.removeEventListener('abort', cancel);
      reject(error);
    });
    child.once('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else resolve({ code, output: output.trim(), stdout: stdout.trim(), stderr: stderr.trim(), truncated });
    });
    if (signal.aborted) cancel();
  });
}
