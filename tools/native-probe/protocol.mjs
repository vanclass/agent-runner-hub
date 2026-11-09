import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BlockedPrerequisite } from './case.mjs';

export async function startProtocol(executable, args, options, budgetMs) {
  const child = spawn(executable, args, options);
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
    if (response.error) throw response.kind === 'blocked'
      ? new BlockedPrerequisite(response.error) : new Error(response.error);
    return response;
  }
  try {
    const started = await next();
    if (started.error) {
      const ErrorType = started.kind === 'blocked' ? BlockedPrerequisite : Error;
      throw new ErrorType(`Native owner ${started.stage}: ${started.error}`);
    }
    if (!started.started || !Number.isInteger(started.pid)) throw new Error('Native owner did not create a Hub');
    return { pid: started.pid, initialPresentation: started.initialPresentation ?? 'background', request, async stop() {
      child.stdin.end(JSON.stringify({ action: 'stop' }) + '\n');
      let result, code;
      try { result = await next(); } finally { code = await closed; }
      if (code || !result.stopped) throw new Error('Native owner teardown failed');
      return result;
    } };
  } catch (error) { child.stdin.end(); await closed; throw error; }
}
