import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

export function isolatedEnvironment(attempt, port) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error('Windows SystemRoot is required');
  return { SystemRoot: systemRoot, WINDIR: systemRoot,
    PATH: path.join(systemRoot, 'System32'),
    USERPROFILE: path.join(attempt, 'user'), APPDATA: path.join(attempt, 'user/roaming'),
    LOCALAPPDATA: path.join(attempt, 'user/local'), TEMP: path.join(attempt, 'tmp'), TMP: path.join(attempt, 'tmp'),
    WEBVIEW2_USER_DATA_FOLDER: path.join(attempt, 'webview2'), TAURI_WEBDRIVER_PORT: String(port) };
}

// Windows adapter owns the Hub's original Process handle. EOF also requests teardown.
export async function startOwner(root, executable, attempt, port, budgetMs) {
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tools/native-probe/windows-owner.ps1'),
      '-Executable', executable, '-Port', String(port), '-BudgetMs', String(budgetMs)],
    { cwd: attempt, shell: false, windowsHide: true, env: isolatedEnvironment(attempt, port), stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = [], buffered = [];
  let ended, stderr = '';
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-4096); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try { const data = JSON.parse(line); const waiter = pending.shift(); if (waiter) waiter.resolve(data); else buffered.push(data); }
    catch { ended = new Error('Invalid native owner response'); }
  });
  const closed = new Promise(resolve => child.once('close', (code) => {
    ended = new Error(`Native owner exited (${code}): ${stderr}`);
    for (const waiter of pending.splice(0)) waiter.reject(ended);
    resolve(code);
  }));
  child.once('error', error => { ended = error; for (const waiter of pending.splice(0)) waiter.reject(error); });
  function next() {
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (ended) return Promise.reject(ended);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ended = new Error('Native owner response timeout');
        child.stdin.end();
        for (const waiter of pending.splice(0)) waiter.reject(ended);
      }, budgetMs * 2);
      pending.push({ resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    });
  }
  async function request(action) {
    child.stdin.write(JSON.stringify({ action }) + '\n');
    const response = await next();
    if (response.error) throw new Error(response.error);
    return response;
  }
  try {
    const started = await next();
    if (started.error) throw new Error(`Native owner ${started.stage}: ${started.error}`);
    if (!started.started || !Number.isInteger(started.pid)) throw new Error('Native owner did not create a Hub');
    return { pid: started.pid, request, async stop() {
      child.stdin.end(JSON.stringify({ action: 'stop' }) + '\n');
      let result, code;
      try { result = await next(); } finally { code = await closed; }
      if (code || !result.stopped) throw new Error('Native owner teardown failed');
      return result;
    } };
  } catch (error) { child.stdin.end(); await closed; throw error; }
}
