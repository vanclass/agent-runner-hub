import path from 'node:path';
import { startProtocol } from '../protocol.mjs';

export function isolatedEnvironment(attempt, port, presentation, { preserveUserHome = false } = {}) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error('Windows SystemRoot is required');
  const userHome = preserveUserHome ? process.env.USERPROFILE : path.join(attempt, 'user');
  if (preserveUserHome && (!userHome || !path.isAbsolute(userHome))) {
    throw new Error('Windows USERPROFILE must be absolute');
  }
  if (preserveUserHome && !path.isAbsolute(process.env.ProgramData ?? '')) {
    throw new Error('Windows ProgramData is required for installed OpenSSH');
  }
  return { SystemRoot: systemRoot, WINDIR: systemRoot,
    PATH: preserveUserHome ? process.env.PATH : path.join(systemRoot, 'System32'),
    USERPROFILE: userHome, APPDATA: path.join(attempt, 'user/roaming'),
    ...(preserveUserHome ? { ProgramData: process.env.ProgramData } : {}),
    LOCALAPPDATA: path.join(attempt, 'user/local'), TEMP: path.join(attempt, 'tmp'), TMP: path.join(attempt, 'tmp'),
    WEBVIEW2_USER_DATA_FOLDER: path.join(attempt, 'webview2'), TAURI_WEBDRIVER_PORT: String(port),
    ...(presentation === 'focus-required' ? { HUB_NATIVE_PRESENTATION: presentation } : {}) };
}


// Retain WG1's original Process handle and nonactivating window operations.
export function startOwner(root, executable, attempt, port, budgetMs, presentation, windowWidth, options) {
  if (windowWidth !== undefined && (!Number.isInteger(windowWidth) || windowWidth <= 0)) {
    throw new TypeError('Native case windowWidth must be a positive integer');
  }
  return startProtocol(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tools/native-probe/windows-owner.ps1'),
      '-Executable', executable, '-Port', String(port), '-BudgetMs', String(budgetMs),
      ...(windowWidth === undefined ? [] : ['-WindowWidth', String(windowWidth)])],
    { cwd: attempt, shell: false, windowsHide: true, env: isolatedEnvironment(attempt, port, presentation, options), stdio: ['pipe', 'pipe', 'pipe'] }, budgetMs);
}
