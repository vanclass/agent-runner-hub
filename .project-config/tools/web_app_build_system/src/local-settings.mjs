import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withBuildOwnership } from './ownership.mjs';

export async function localSettings(local) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(local, 'settings.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('local/settings.json must contain a settings object.');
    return value;
  }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export async function updateLocalSettings(root, local, signal, update) {
  return withBuildOwnership(root, path.join(root, '.project-config/managed/web-app-launch/cache'), signal,
    () => {}, async () => {
      const settings = await localSettings(local);
      await update(settings);
      signal.throwIfAborted();
      await fs.mkdir(local, { recursive: true });
      const temporary = path.join(local, 'settings-' + randomUUID() + '.next');
      try {
        await fs.writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx' });
        signal.throwIfAborted();
        await fs.rename(temporary, path.join(local, 'settings.json'));
      } finally { await fs.rm(temporary, { force: true }); }
    }, true);
}
