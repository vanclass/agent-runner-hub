import path from 'node:path';
import { startProtocol } from '../protocol.mjs';

export function isolatedEnvironment(attempt, port) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error('Windows SystemRoot is required');
  return { SystemRoot: systemRoot, WINDIR: systemRoot,
    PATH: path.join(systemRoot, 'System32'),
    USERPROFILE: path.join(attempt, 'user'), APPDATA: path.join(attempt, 'user/roaming'),
    LOCALAPPDATA: path.join(attempt, 'user/local'), TEMP: path.join(attempt, 'tmp'), TMP: path.join(attempt, 'tmp'),
    WEBVIEW2_USER_DATA_FOLDER: path.join(attempt, 'webview2'), TAURI_WEBDRIVER_PORT: String(port) };
}


// Retain WG1's original Process handle and nonactivating window operations.
export function startOwner(root, executable, attempt, port, budgetMs) {
  return startProtocol(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tools/native-probe/windows-owner.ps1'),
      '-Executable', executable, '-Port', String(port), '-BudgetMs', String(budgetMs)],
    { cwd: attempt, shell: false, windowsHide: true, env: isolatedEnvironment(attempt, port), stdio: ['pipe', 'pipe', 'pipe'] }, budgetMs);
}