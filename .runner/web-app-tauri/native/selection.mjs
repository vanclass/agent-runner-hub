import fs from 'node:fs/promises';
import path from 'node:path';
const toolingHint = 'Desktop development/packaging requires Rust/Cargo. Windows needs MSVC, C++ tools, Windows SDK and WebView2; macOS needs Xcode Command Line Tools and its native Rust target.';

export async function runtimeSelection(root, buildSystem = false, hint = toolingHint) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.runner/project.json'), 'utf8'));
    if (manifest.schema_version !== 1 || manifest.kind !== 'project_management') throw new Error('Invalid Project manifest.');
    const child = (state, group, option) => state?.components?.some(c => c.component_id === 'WebApp'
      && c.children?.some(item => state === manifest.desired
        ? item.group_id === group && item.options?.some(o => o.option_id === option)
        : item.group_id === group && item.option_id === option));
    const runtime = child(manifest.desired, 'Runtimes', 'Tauri2') && child(manifest.applied, 'Runtimes', 'Tauri2');
    const tool = !buildSystem || (child(manifest.desired, 'Tools', 'WebAppBuildSystem')
      && child(manifest.applied, 'Tools', 'WebAppBuildSystem'));
    if (!runtime || !tool) return { enabled: false, hints: [
      'Select Web App > Runtimes > Tauri 2' + (buildSystem ? ' and Tools > Web App Build System' : '')
      + ', then Review/Apply in Project Settings.',
      hint] };
    return { enabled: true, hints: [] };
  } catch (error) {
    return { enabled: false, hints: ['Restore the portable .runner/project.json manifest and Apply Tauri 2 selection'
      + (buildSystem ? ' with Web App Build System' : '') + ': ' + error.message, hint] };
  }
}
