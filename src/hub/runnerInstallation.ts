import { invoke, isTauri } from '@tauri-apps/api/core';
import { HubError, msg } from './i18n';

export type RunnerInstallation = { root: string; python: string };
const storageKey = 'agent-runner-hub.installation';

export function savedRunnerLocation() {
  try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
}
export function saveRunnerLocation(root: string) {
  try { localStorage.setItem(storageKey, root); } catch { /* Verification remains valid for this window. */ }
}
export async function resolveRunnerInstallation(location: string) {
  if (!isTauri()) throw new HubError(msg('location.nativeRequired'));
  return invoke<RunnerInstallation>('runner_resolve', { location });
}
