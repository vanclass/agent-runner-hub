import readline from 'node:readline';
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

function wrap(lines) {
  const width = Math.max(30, (process.stdout.columns || 100) - 1);
  return lines.flatMap(line => {
    const parts = [];
    while (line.length > width) { parts.push(line.slice(0, width)); line = '      ' + line.slice(width); }
    return [...parts, line];
  });
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

async function choose(targets, selected, lines, signal) {
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
  readline.emitKeypressEvents(process.stdin);
  let rowCount = 0;
  function render() {
    if (rowCount) process.stdout.write('\x1b[' + rowCount + 'A\x1b[J');
    const rows = wrap(menuLines(targets, selected));
    process.stdout.write(rows.join('\n') + '\n');
    rowCount = rows.length;
  }
  return new Promise(resolve => {
    let finished = false, digits = '';
    function finish(choice) {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', cancelled);
      process.stdin.removeListener('keypress', keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\x1b[?25h');
      resolve({ choice, selected });
    }
    const cancelled = () => finish('q');
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
        digits = ''; move(key.name === 'up' ? -1 : 1); render();
      }
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('\x1b[?25l');
    process.stdin.on('keypress', keypress);
    signal.addEventListener('abort', cancelled, { once: true });
    render();
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
