import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { command } from '../native/process.mjs';
import { withBuildOwnership } from '../ownership.mjs';

export function thumbprint(value) {
  const result = String(value || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(result)) throw new Error('Use the certificate’s 40-hex thumbprint from CurrentUser\\My.');
  return result;
}

export function signingSelection(value) {
  if (value === undefined || value === null) return null;
  const endpoint = new URL(value.timestampUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Use an HTTP(S) RFC 3161 timestamp endpoint without credentials, query or fragment.');
  }
  return { thumbprint: thumbprint(value.thumbprint), timestampUrl: endpoint.href };
}

export async function windowsEvidence(action, root, signal, values = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Certificate management and signing require Windows x64.');
  const script = fileURLToPath(new URL('./windows.ps1', import.meta.url));
  const shell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await command(shell, ['-NoProfile', '-NonInteractive', '-Command',
    '& $env:BUILD_SIGN_SCRIPT -Action $env:BUILD_SIGN_ACTION -File $env:BUILD_SIGN_FILE'], root, signal,
    { env: { BUILD_SIGN_SCRIPT: script, BUILD_SIGN_ACTION: action, BUILD_SIGN_FILE: values.file || '' } });
  if (result.code !== 0 || result.truncated) throw new Error('Windows signing ' + action + ' failed: ' + result.output);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Windows signing returned incomplete evidence. Retry with a working Windows PowerShell/SDK.'); }
}

export async function certificates(root, signal) {
  return windowsEvidence('List', root, signal);
}

export function requireCertificate(list, selected) {
  const certificate = list.find(item => item.thumbprint === selected.thumbprint);
  if (!certificate) throw new Error('Selected certificate is missing from CurrentUser\\My. Select a replacement or remove selection to build unsigned.');
  if (!certificate.usable) throw new Error('Selected certificate is expired, not yet valid, or has no private key. Select a usable code-signing certificate.');
  return certificate;
}

export async function localSettings(local) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(local, 'settings.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('local/settings.json must contain a settings object.');
    return value;
  }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export async function certificateStatus(root, local, signal) {
  const selected = signingSelection((await localSettings(local)).windowsSigning);
  if (!selected) return { status: 'unsigned', selected: null };
  try {
    const certificate = requireCertificate(await certificates(root, signal), selected);
    return { status: 'selected', selected, certificate, keyStatus: 'Signing proves private-key access; not tested by listing.' };
  } catch (error) {
    signal.throwIfAborted();
    return { status: 'invalid', selected, reason: error.message };
  }
}

export async function selectCertificate(root, local, signal, value) {
  return withBuildOwnership(root, path.join(root, '.project-config/managed/web-app-launch/cache'), signal,
    () => {}, async () => {
      const settings = await localSettings(local);
      if (value === null) delete settings.windowsSigning;
      else {
        const selected = signingSelection(value);
        const certificate = requireCertificate(await certificates(root, signal), selected);
        settings.windowsSigning = { ...selected, subject: certificate.subject, notAfter: certificate.notAfter };
      }
      await fs.mkdir(local, { recursive: true });
      const temporary = path.join(local, 'settings-' + randomUUID() + '.next');
      try {
        signal.throwIfAborted();
        await fs.writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx' });
        signal.throwIfAborted();
        await fs.rename(temporary, path.join(local, 'settings.json'));
      } finally { await fs.rm(temporary, { force: true }); }
    }, true);
}
