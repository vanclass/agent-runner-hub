import fs from 'node:fs/promises';
import path from 'node:path';
import { startProtocol } from '../protocol.mjs';
import { BlockedPrerequisite } from '../case.mjs';
import { command } from '../../../.runner/web-app-tauri/native/process.mjs';

export function isolatedEnvironment(attempt, port, presentation = 'background') {
  return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8',
    HOME: path.posix.join(attempt, 'user'), CFFIXED_USER_HOME: path.posix.join(attempt, 'user'),
    TMPDIR: path.posix.join(attempt, 'tmp'), TAURI_WEBDRIVER_PORT: String(port),
    HUB_NATIVE_PRESENTATION: presentation };
}
// Inspect every TCP listener of the owned PID, not just the requested port.
// lsof selections use -a; malformed/IPv6/wildcard/additional listeners fail closed.
export function ownedListeners(records, pid, port) {
  let owner, file;
  const files = [];
  for (const line of records.split('\n').filter(Boolean)) {
    const tag = line[0], value = line.slice(1);
    if (tag === 'p') owner = Number(value);
    else if (tag === 'f') { file = { pid: owner }; files.push(file); }
    else if (file && tag === 't') file.type = value;
    else if (file && tag === 'P') file.protocol = value;
    else if (file && tag === 'n') file.endpoint = value;
    else if (file && tag === 'T' && value.startsWith('ST=')) file.state = value.slice(3);
  }
  if (!records.trim()) return [];
  if (files.length !== 1 || files.some(f => f.pid !== pid || f.type !== 'IPv4' ||
    f.protocol !== 'TCP' || f.endpoint !== '127.0.0.1:' + port || f.state !== 'LISTEN')) {
    throw new BlockedPrerequisite('Owned Hub must expose exactly the selected IPv4 loopback WebDriver listener');
  }
  return [{ address: '127.0.0.1', port }];
}
export async function startOwner(root, executable, attempt, port, budgetMs, presentation = 'background') {
  const binary = path.join(attempt, 'macos-owner');
  try { await fs.access(binary); }
  catch {
    const built = await command('/usr/bin/xcrun', ['swiftc', '-swift-version', '5',
      path.join(root, 'tools/native-probe/platforms/macos-owner.swift'), '-o', binary],
    attempt, AbortSignal.timeout(budgetMs), {});
    if (built.code) throw new BlockedPrerequisite('Xcode Swift native owner compilation failed: ' + built.output);
  }
  const owner = await startProtocol(binary, [executable, String(port), String(budgetMs), presentation, attempt],
    { cwd: attempt, shell: false, env: isolatedEnvironment(attempt, port, presentation),
      stdio: ['pipe', 'pipe', 'pipe'] }, budgetMs);
  return { ...owner, async request(action) {
    const state = await owner.request(action);
    if (action === 'listener') {
      state.listeners = ownedListeners(state.listenerRecords, owner.pid, port);
      delete state.listenerRecords;
    }
    return state;
  } };
}
