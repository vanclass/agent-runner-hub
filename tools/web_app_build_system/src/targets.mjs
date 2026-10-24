import fs from 'node:fs/promises';
import { webAdapter } from './web.mjs';
import { tauriAdapter, macosTauriAdapter } from './tauri.mjs';
import { electronAdapter } from './electron.mjs';
import { androidAdapter } from './android.mjs';
import { foundation, ASTRO } from './foundation.mjs';

const adapters = new Map([['web', webAdapter]]);
adapters.set('windows-tauri', tauriAdapter);
adapters.set('macos-tauri', macosTauriAdapter);
adapters.set('android-tauri', androidAdapter);
adapters.set('windows-electron', electronAdapter);

export async function targetCatalog(root, signal) {
  const definitions = JSON.parse(await fs.readFile(new URL('../targets.json', import.meta.url), 'utf8'));
  const choice = await foundation(root, { requireApplied: true });
  if (choice === ASTRO) Object.assign(definitions.find(t => t.id === 'web'), {
    label: 'Web / Astro', outputFormat: 'Astro 6 static HTML and assets',
    runtimeDependency: 'Even Node.js >=22.12.0 + npm >=9.6.5 + Astro 6 / TypeScript',
  });
  const targets = [];
  let shortcut = 0;
  for (const definition of definitions) {
    const adapter = adapters.get(definition.adapter);
    const implemented = definition.implementationStatus === 'implemented' && Boolean(adapter);
    const readiness = implemented ? await adapter.inspect(root, signal)
      : { ready: false, preparable: false, hints: definition.requirements };
    const enabled = implemented && readiness.enabled !== false;
    targets.push({ ...definition, implementationStatus: !implemented ? 'not-implemented' : enabled ? 'implemented' : 'selection-required',
      hostReadiness: !implemented ? 'unavailable' : !enabled ? 'selection-required'
        : readiness.verificationStatus === 'unavailable' ? 'verification-unavailable'
        : readiness.ready ? 'ready' : 'preparation-required',
      selectionShortcut: enabled ? String(++shortcut) : null,
      verificationStatus: readiness.verificationStatus || (implemented ? 'not-yet-verified' : 'unavailable'),
      hints: readiness.hints, preparable: readiness.preparable });
  }
  return targets;
}

export function adapterFor(target) {
  if (target.implementationStatus === 'selection-required') {
    throw new Error(target.label + ' is unavailable until runtime selection is applied. ' + target.hints.join('; '));
  }
  if (target.implementationStatus !== 'implemented' || !adapters.has(target.adapter)) {
    throw new Error(target.label + ' is Not Implemented. Required: ' + target.runtimeDependency + '; ' + target.requirements.join('; '));
  }
  return adapters.get(target.adapter);
}
