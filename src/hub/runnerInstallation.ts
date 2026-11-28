import { invoke, isTauri } from '@tauri-apps/api/core';
import { errorText, HubError, msg, type MessageKey } from './i18n';

export type RunnerInstallation = { root: string; python: string };
const launchReasons = {
  'missing-installation': 'lifecycle.missingInstallation',
  'installation-unavailable': 'lifecycle.installationUnavailable',
  'permission': 'lifecycle.permission',
  'invalid-installation': 'lifecycle.invalidInstallation',
  'managed-python': 'lifecycle.managedPython',
  'process-launch': 'lifecycle.processLaunch',
} as const satisfies Record<string, MessageKey>;

export function launchFailure(location: string, reason: unknown, verifying = false) {
  const code = reason && typeof reason === 'object' && 'code' in reason && 'detail' in reason
    && typeof reason.code === 'string' && typeof reason.detail === 'string' ? reason.code : '';
  const notCreated = Object.hasOwn(launchReasons, code);
  const cause = verifying && ['missing-installation', 'invalid-installation'].includes(code)
    ? msg('lifecycle.chooseInstallation') : notCreated ? msg(launchReasons[code as keyof typeof launchReasons])
      : msg(verifying ? 'lifecycle.installationUnavailable' : 'lifecycle.launchUnknown');
  return { notCreated, detail: msg(verifying ? 'lifecycle.verifyInstallation' : 'lifecycle.launch', {
    location, cause, code, diagnostic: errorText(reason),
  }) };
}
const storageKey = 'agent-runner-hub.installation';

export function savedRunnerLocation() {
  try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
}
export function saveRunnerLocation(root: string) {
  try { localStorage.setItem(storageKey, root); } catch { /* Verification remains valid for this window. */ }
}
const resolving = new Map<string, Promise<RunnerInstallation>>();

export async function resolveRunnerInstallation(location: string) {
  if (!isTauri()) throw new HubError(msg('location.nativeRequired'));
  const key = location.trim();
  const pending = resolving.get(key);
  if (pending) return pending;
  const request = invoke<RunnerInstallation>('runner_resolve', { location: key })
    .catch(reason => { throw new HubError(launchFailure(key, reason, true).detail); })
    .finally(() => resolving.delete(key));
  resolving.set(key, request);
  return request;
}
