import fs from 'node:fs/promises';
import path from 'node:path';

export async function desktopFeatures(root) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, '.runner/project.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const options = (state, applied) => state?.components?.filter(c => c.component_id === 'WebApp')
    .flatMap(c => c.children || []).filter(c => c.group_id === 'Tools')
    .flatMap(c => applied ? [c.option_id] : c.options.map(o => o.option_id)) || [];
  const desired = options(manifest.desired, false), applied = options(manifest.applied, true);
  return [['DesktopTerminal', 'desktop-terminal'], ['TauriNativeIO', 'native-io']]
    .filter(([id]) => desired.includes(id) && applied.includes(id)).map(([, feature]) => feature);
}

export async function stageDesktop(root, destination, config, platform) {
  if (platform === 'android') return;
  const features = await desktopFeatures(root);
  if (!features.length) return;
  config.build ||= {};
  config.build.features = [...new Set([...(config.build.features || []), ...features])];
  if (features.includes('native-io')) {
    const file = path.join(root, '.runner/web-app-desktop/io/capability.json');
    const capability = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(path.join(destination, 'capabilities/desktop-native-io.json'), JSON.stringify(capability), { flag: 'wx' });
    if (config.app?.security?.capabilities) config.app.security.capabilities.push(capability.identifier);
  }
}
