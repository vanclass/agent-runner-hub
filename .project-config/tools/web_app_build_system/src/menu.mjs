import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { targetCatalog } from './targets.mjs';

const groups = [['Build Ready', 'ready'], ['Environment Preparation Required', 'preparation-required'],
  ['Runtime Selection Required', 'selection-required'],
  ['Native Verification Unavailable', 'verification-unavailable'], ['Not Implemented', 'unavailable']];

function selectable(targets) {
  return groups.flatMap(([, state]) => targets.filter(target =>
    target.hostReadiness === state && target.implementationStatus === 'implemented'));
}

function menuLines(targets, selected) {
  const lines = ['Web App Build System', ''];
  for (const [heading, state] of groups) {
    lines.push(heading);
    const group = targets.filter(target => target.hostReadiness === state);
    if (!group.length) lines.push('  None');
    for (const target of group) {
      const executable = target.implementationStatus === 'implemented';
      lines.push('  ' + (selected === target.id ? '> ' : '  ')
        + (executable ? target.selectionShortcut + '. ' : '') + target.label);
      lines.push('      Readiness: ' + heading + ' | Verification: ' + target.verificationStatus);
      if (!executable) lines.push('      Requires: ' + target.runtimeDependency);
      for (const hint of target.hints || []) lines.push('      ' + hint);
    }
    lines.push('');
  }
  lines.push('Number / Enter: Build selected target (prepare if required)');
  lines.push('Up / Down: Select target   P: Prepare Environment for selected target');
  lines.push('B / Q / Esc: Back / Exit    Ctrl+C: Cancel');
  return lines;
}

function clip(text, width) {
  let result = '', cells = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) continue;
    // Reserve a slot for marks in the Windows console's legacy character grid.
    const size = /\p{Mark}/u.test(char) || code === 0x200d || code === 0xfe0f ? (process.platform === 'win32' ? 1 : 0)
      : code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
        || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7a3
        || code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe6f
        || code >= 0xff01 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6
        || code >= 0x1f300 && code <= 0x1faff || code >= 0x20000) ? 2 : 1;
    if (cells + size > width) break;
    result += char; cells += size;
  }
  return result;
}

function viewport(targets, selected, dimensions) {
  const width = Math.max(1, dimensions.columns - 1);
  const capacity = Math.max(1, dimensions.rows - 1);
  const all = menuLines(targets, selected);
  const focus = Math.max(0, all.findIndex(line => line.startsWith('  > ')));
  if (capacity < 4) return [clip(all[focus].trimStart(), width)];
  const body = all.slice(2, -3), room = capacity - 3;
  const start = Math.max(0, Math.min(focus - 2 - Math.floor(room / 2), body.length - room));
  const footer = width >= 80
    ? 'Up/Down: Select | Enter/Number: Build | P: Prepare | B/Q/Esc: Back | Ctrl+C: Cancel'
    : width >= 30 ? 'Up/Down Enter/# P B/Esc Ctrl+C' : 'Up/Down # P B ^C';
  return [all[0], ...body.slice(start, start + room),
    (start ? 'More above | ' : '') + (start + room < body.length ? 'More below' : ''), footer]
    .map(line => clip(line, width));
}

export function lineInput() {
  const interface_ = readline.createInterface({ input: process.stdin, terminal: false });
  const queue = [];
  let waiting, closed = false;
  interface_.on('line', line => {
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(line); }
    else queue.push(line);
  });
  interface_.on('close', () => { closed = true; if (waiting) waiting(null); });
  return {
    next: () => queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve(null) : new Promise(resolve => { waiting = resolve; }),
    close: () => interface_.close(),
  };
}

function readTerminalSize(file) {
  if (!file) return { columns: process.stdout.columns || 100, rows: process.stdout.rows || 24 };
  const local = fs.realpathSync(path.resolve(import.meta.dirname, '../.local'));
  const relative = path.relative(local, fs.realpathSync(file));
  if (!/^console-\d+-\d+[\\/]viewport\.json$/.test(relative)) {
    throw new Error('Windows console viewport escaped its invocation directory. Restart build.cmd.');
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schema !== 1 || value.owner !== process.ppid
      || !Number.isInteger(value.columns) || value.columns < 1
      || !Number.isInteger(value.rows) || value.rows < 1
      || typeof value.cursorVisible !== 'boolean' || typeof value.wrap !== 'boolean') {
    throw new Error('Invalid Windows console viewport observation. Restart build.cmd.');
  }
  if (!Number.isSafeInteger(value.position) || value.position < 0 || typeof value.positioned !== 'boolean'
      || !Number.isInteger(value.bufferColumns) || value.bufferColumns < value.columns
      || !Number.isInteger(value.bufferRows) || value.bufferRows < value.rows) {
    throw new Error('Invalid Windows console positioning observation. Restart build.cmd.');
  }
  return { columns: value.columns, rows: value.rows, cursorVisible: value.cursorVisible,
    wrap: value.wrap, position: value.position, positioned: value.positioned,
    bufferColumns: value.bufferColumns, bufferRows: value.bufferRows };
}

const geometry = size => [size.columns, size.rows, size.bufferColumns, size.bufferRows].join(':');

function terminalSize(file, signal, attempt = 0) {
  try { return readTerminalSize(file); } catch (error) {
    // Windows replacement can briefly remove the name; only a fresh validated read supplies geometry.
    if (!file || !['ENOENT', 'EBUSY'].includes(error.code) || attempt === 5) throw error;
    return delay(10, undefined, { signal }).then(() => terminalSize(file, signal, attempt + 1));
  }
}

let positionSequence = 0;
async function positionBand(file, dimensions, count, clear) {
  const sequence = ++positionSequence;
  const request = path.join(path.dirname(file), 'position.request');
  fs.writeFileSync(request + '.next', [1, process.pid, sequence, dimensions.columns,
    dimensions.rows, count, Number(clear), dimensions.bufferColumns, dimensions.bufferRows].join(' '), 'utf8');
  fs.renameSync(request + '.next', request);
  for (let attempt = 0; attempt < 100; attempt++) {
    const next = await terminalSize(file);
    if (next.position === sequence) return next;
    await delay(10);
  }
  throw new Error('Windows console positioning did not complete. Restart build.cmd.');
}

async function choose(targets, selected, lines, signal) {
  signal.throwIfAborted();
  const entries = selectable(targets);
  const move = direction => {
    if (!entries.length) return;
    const index = entries.findIndex(target => target.id === selected);
    selected = entries[(index + direction + entries.length) % entries.length].id;
  };
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    while (true) {
      signal.throwIfAborted();
      console.log(menuLines(targets, selected).join('\n'));
      const choice = (await lines.next())?.trim().toLowerCase() ?? 'q';
      if (choice === 'up' || choice === 'down') { move(choice === 'up' ? -1 : 1); continue; }
      return { choice, selected };
    }
  }
  const wasRaw = Boolean(process.stdin.isRaw), wasPaused = process.stdin.readableFlowing !== true;
  const viewportFile = process.platform === 'win32' ? process.env.WEB_APP_BUILD_VIEWPORT : undefined;
  let dimensions = await terminalSize(viewportFile, signal);
  const write = text => process.stdout.write(text);
  readline.emitKeypressEvents(process.stdin);
  let previous = [], renderedSize = '';
  function renderRows(rows) {
    const capacity = Math.max(1, dimensions.rows - 1);
    const count = Math.min(capacity, Math.max(previous.length, rows.length));
    if (!count) return;
    const size = geometry(dimensions);
    // Win32 reflow invalidates cell locations even when projected text is unchanged.
    const old = size === renderedSize ? previous.slice(-count) : [];
    if (viewportFile) {
      let output = '\x1b[s';
      for (let index = 0; index < rows.length; index++) {
        if (old[index] === rows[index]) continue;
        output += '\r' + (index ? '\x1b[' + index + 'B' : '') + '\x1b[2K' + rows[index];
        output += '\r' + (index ? '\x1b[' + index + 'A' : '');
      }
      write(output + '\x1b[u');
      previous = rows; renderedSize = size;
      return;
    }
    if (dimensions.rows === 1) {
      const row = rows[0] || '';
      if (previous[0] !== row || size !== renderedSize) write('\r\x1b[2K' + row);
      previous = [row]; renderedSize = size;
      return;
    }
    let output = '';
    if (!previous.length) output += '\r\n'.repeat(count) + '\x1b[1A';
    else if (count > previous.length) output += '\r\n'.repeat(count - previous.length);
    rows = [...rows, ...Array(Math.max(0, count - rows.length)).fill('')];
    for (let index = 0; index < count; index++) {
      if (old[index] === rows[index]) continue;
      const distance = count - index - 1;
      output += '\r' + (distance ? '\x1b[' + distance + 'A' : '') + '\x1b[2K' + rows[index] + '\r\n';
      output += distance > 1 ? '\x1b[' + (distance - 1) + 'B' : distance === 0 ? '\x1b[1A' : '';
    }
    if (size !== renderedSize) output += '\r\n\x1b[2K\x1b[1A';
    if (output) write(output);
    renderedSize = size;
    previous = rows;
  }

  function render() {
    const rows = viewport(targets, selected, dimensions);
    renderRows(rows);
  }
  return new Promise((resolve, reject) => {
    let finished = false, entered = false, digits = '';
    const observation = new AbortController();
    let pendingSize;
    async function finish(choice, error) {
      if (finished) return;
      finished = true;
      observation.abort();
      signal.removeEventListener('abort', cancelled);
      process.stdin.removeListener('keypress', keypress);
      process.stdout.removeListener('resize', resized);
      if (viewportFile) fs.unwatchFile(viewportFile, observed);
      process.stdin.removeListener('error', failed);
      process.stdin.removeListener('end', cancelled);
      process.stdout.removeListener('error', failed);
      try {
        process.stdin.setRawMode(wasRaw);
        if (wasPaused) process.stdin.pause();
      } catch (cause) { error ||= cause; }
      try {
        if (entered) {
          if (viewportFile) {
            await pendingSize?.catch(cause => { if (cause.name !== 'AbortError') error ||= cause; });
            dimensions = await positionBand(viewportFile, dimensions, 0, true);
          } else {
            renderRows([]);
            if (previous.length > 1) write('\x1b[' + (previous.length - 1) + 'A');
          }
        }
      } catch (cause) { error ||= cause; }
      try {
        if (entered) write(viewportFile
          ? '\r\x1b[?7' + (dimensions.wrap ? 'h' : 'l') + '\x1b[?25' + (dimensions.cursorVisible ? 'h' : 'l')
          : '\r\x1b[?7h\x1b[?7r\x1b[?25h\x1b[?25r');
      } catch (cause) { error ||= cause; }
      if (error) reject(error); else resolve({ choice, selected });
    }
    const cancelled = () => finish('q');
    const failed = error => finish('q', error);
    let dirty = false;
    const redraw = (force = true) => {
      if (viewportFile) {
        if (finished) return;
        if (pendingSize) { dirty ||= force; return; }
        pendingSize = (async () => {
          do {
            dirty = false;
            dimensions = await terminalSize(viewportFile, observation.signal);
            const changed = renderedSize !== geometry(dimensions);
            if (!force && !changed) return;
            const rows = viewport(targets, selected, dimensions);
            dimensions = await positionBand(viewportFile, dimensions, rows.length, changed);
            if (finished) return;
            if (!dimensions.positioned) { dirty = true; continue; }
            renderRows(rows);
            force = true;
          } while (dirty);
        })();
        pendingSize.catch(failed).finally(() => { pendingSize = undefined; });
        return;
      }
      if (finished || pendingSize) return;
      try {
        const size = terminalSize(viewportFile, observation.signal);
        if (size instanceof Promise) {
          pendingSize = size;
          size.then(next => {
            pendingSize = undefined;
            if (finished) return;
            dimensions = next; render();
          }).catch(failed);
        } else { dimensions = size; render(); }
      } catch (error) { failed(error); }
    };
    const observed = () => redraw(false);
    const resized = () => { if (!viewportFile) redraw(); };
    function keypress(text, key) {
      if ((key.ctrl && key.name === 'c') || ['escape', 'q', 'b'].includes(key.name)) finish('q');
      else if (key.name === '0' && !digits) finish('q');
      else if (key.name === 'p') finish('p');
      else if (key.name === 'return') finish(digits || '');
      else if (/^[0-9]$/.test(text || '')) {
        digits += text;
        const matches = entries.filter(target => target.selectionShortcut.startsWith(digits));
        if (matches.length === 1 && matches[0].selectionShortcut === digits) finish(digits);
        else if (!matches.length) digits = '';
      } else if (key.name === 'up' || key.name === 'down') {
        digits = ''; move(key.name === 'up' ? -1 : 1); redraw();
      }
    }
    try {
      process.stdin.on('error', failed);
      process.stdout.on('error', failed);
      process.stdin.on('end', cancelled);
      process.stdin.on('keypress', keypress);
      process.stdout.on('resize', resized);
      if (viewportFile) fs.watchFile(viewportFile, { interval: 100, persistent: false }, observed);
      signal.addEventListener('abort', cancelled, { once: true });
      process.stdin.setRawMode(true);
      process.stdin.resume();
      // Keep one guard row below the retained band; only changed rows are rewritten.
      entered = true;
      write('\x1b[?7s\x1b[?7l\x1b[?25s\x1b[?25l');
      redraw();
      if (signal.aborted) cancelled();
    } catch (error) { failed(error); }
  });
}

export async function menu(root, local, lines, run, signal) {
  let selected;
  while (true) {
    signal.throwIfAborted();
    console.log('[Build System] Checking build readiness...');
    const targets = await targetCatalog(root, signal);
    const entries = selectable(targets);
    if (!entries.some(target => target.id === selected)) selected = entries[0]?.id;
    const answer = await choose(targets, selected, lines, signal);
    const { choice } = answer;
    selected = answer.selected;
    if (['q', 'b', 'back', 'exit', '0', 'escape', 'cancel', '\x1b', '\x03'].includes(choice)) return;
    const target = entries.find(item => ['', 'p'].includes(choice) ? item.id === selected
      : item.selectionShortcut === choice || item.id === choice);
    if (!target) {
      console.log('Choose a target number, Up/Down, P, or Back. Not Implemented targets cannot execute.');
      continue;
    }
    selected = target.id;
    await run(target, { prepare: true, prepareOnly: choice === 'p' });
  }
}
