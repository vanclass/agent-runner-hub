import fs from 'node:fs/promises';
import path from 'node:path';

export const VITE = 'ViteVanillaTS';
export const ASTRO = 'AstroTS';
const incompatible = new Set(['Frameworks', 'Runtimes', 'Styling', 'UIIcons', 'Tools']);

function choice(component, applied = false) {
  if (!component) return VITE;
  const groups = (component.children || []).filter(c => c.group_id === 'Foundation');
  const options = applied ? groups.map(c => c.option_id) : groups.flatMap(g => g.options.map(c => c.option_id));
  if (!groups.length) return VITE;
  if (options.length !== 1 || ![VITE, ASTRO].includes(options[0])) {
    throw new Error('Foundation requires exactly one supported selection. Review Project Settings.');
  }
  const supported = (group, option) => group === 'Frameworks' && option === 'React'
    || group === 'Styling' && option === 'TailwindCSS'
    || group === 'Tools' && ['WebAppBuildSystem', 'ReleasePipeline'].includes(option);
  if (options[0] === ASTRO && (component.children || []).some(c => incompatible.has(c.group_id)
      && (applied ? !supported(c.group_id, c.option_id) : c.options?.some(o => !supported(c.group_id, o.option_id))))) {
    throw new Error('Astro supports React, Tailwind CSS, Web App Build System and Release Pipeline. Preserve the project and resolve unsupported selections.');
  }
  return options[0];
}

export async function foundation(root, { requireApplied = false } = {}) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, '.runner/project.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return VITE; throw error; }
  if (manifest.schema_version !== 1 || manifest.kind !== 'project_management'
      || !Array.isArray(manifest.desired?.components) || !Array.isArray(manifest.applied?.components)) {
    throw new Error('Invalid Project Composition metadata. Restore this checkout’s project manifest.');
  }
  const desired = manifest.desired.components.find(c => c.component_id === 'WebApp');
  const applied = manifest.applied.components.find(c => c.component_id === 'WebApp');
  const selected = choice(desired);
  if (requireApplied && selected === ASTRO && !applied) {
    throw new Error('Astro Foundation is not applied yet. Finish New Project or the reviewed Settings Apply before launching.');
  }
  if (applied && selected !== choice(applied, true)) {
    throw new Error('Foundation conversion is unsupported. Restore the initialized Foundation or create a separate project.');
  }
  return selected;
}
