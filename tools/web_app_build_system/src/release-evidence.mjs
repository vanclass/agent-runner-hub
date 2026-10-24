// Build-owned release provenance. No Runner import or release request is used here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { foundation, ASTRO } from './foundation.mjs';
import { verifyAstroOutput } from './astro-output.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtimes = { web: 'browser', 'windows-tauri': 'Tauri2', 'android-tauri': 'Tauri2', 'windows-electron': 'Electron' };
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,159}$/.test(value);
async function read(root, relative) {
  const file = path.join(root, relative), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await fs.realpath(file) !== file) {
    throw new Error('Release evidence requires plain project files.');
  }
  const bytes = await fs.readFile(file);
  return { value: JSON.parse(bytes.toString('utf8')), sha256: hash(bytes) };
}

export async function captureReleaseInputs(root, target) {
  try {
    const binding = await read(root, 'tools/web_app_build_system/release-binding.json');
    const manifest = await read(root, '.runner/project.json');
    const project = binding.value, runtime = runtimes[target.id];
    const choice = await foundation(root, { requireApplied: true });
    let foundationResource;
    if (project.schema !== 1 || project.producer !== 'web-app-build-system' || project.project_type !== 'WebApp'
        || !identity(project.project_id) || !runtime || manifest.value.schema_version !== 1
        || manifest.value.kind !== 'project_management') throw new Error('Unbound project.');
    for (const [state, applied] of [[manifest.value.desired, false], [manifest.value.applied, true]]) {
      const parents = state.components.filter(c => c.component_id === 'WebApp');
      if (parents.length !== 1) throw new Error('Missing Web App selection.');
      const options = group => (parents[0].children || []).filter(c => c.group_id === group)
        .flatMap(c => applied ? [c.option_id] : c.options.map(o => o.option_id));
      const foundation = options('Foundation');
      if (foundation.length && (foundation.length !== 1 || foundation[0] !== choice)) throw new Error('Unsupported Foundation.');
      if (choice === ASTRO) {
        if (runtime !== 'browser' || foundation.length !== 1) throw new Error('Astro requires applied browser Foundation.');
        if (applied) foundationResource = parents[0].children.find(c => c.group_id === 'Foundation').resource;
      }
      if (options('Tools').filter(o => o === 'WebAppBuildSystem').length !== 1
          || runtime !== 'browser' && options('Runtimes').filter(o => o === runtime).length !== 1) {
        throw new Error('Required Build System/runtime is not selected and applied.');
      }
    }
    if (choice === ASTRO && (foundationResource?.identity !== 'WebApp.AstroTS'
        || !/^[a-f0-9]{64}$/.test(foundationResource.digest))) throw new Error('Applied Astro Foundation identity unavailable.');
    let versionPath = runtime === 'Tauri2' ? 'src-tauri/tauri.conf.json' : 'package.json';
    let source = await read(root, versionPath);
    if (target.id === 'android-tauri') {
      const overlayPath = 'src-tauri/tauri.android.conf.json';
      const overlay = await read(root, overlayPath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (overlay && Object.hasOwn(overlay.value, 'version')) { source = overlay; versionPath = overlayPath; }
    }
    const productVersion = source.value.version;
    if (!identity(productVersion)) throw new Error('Product version unavailable.');
    return { status: 'verified', project, bindingSha256: binding.sha256, selectionSha256: manifest.sha256,
      selection: { foundation: choice, runtime, buildSystem: true },
      ...(choice === ASTRO ? { foundationResource } : {}),
      versionSource: { path: versionPath, sha256: source.sha256, value: productVersion }, productVersion };
  } catch {
    // Missing release provenance must not disable independently usable builds.
    return { status: 'unavailable' };
  }
}

async function inventory(root) {
  const files = [], directories = [];
  async function visit(folder, prefix = '') {
    for (const name of (await fs.readdir(folder)).sort()) {
      const relative = prefix + name, file = path.join(folder, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || await fs.realpath(file) !== file) throw new Error('Indirect release product.');
      if (stat.isDirectory()) { directories.push(relative); await visit(file, relative + '/'); }
      else if (stat.isFile() && stat.nlink === 1) {
        const bytes = await fs.readFile(file);
        files.push({ path: relative, size: bytes.length, sha256: hash(bytes) });
      } else throw new Error('Unsupported release product.');
    }
  }
  await visit(root);
  return { files, directories };
}

export async function writeReleaseEvidence(attempt, result, resultBytes, capture) {
  const base = { schema: 1, producer: 'web-app-build-system', executionId: result.id,
    target: result.target, resultSha256: hash(resultBytes), status: 'unavailable' };
  let evidence = base;
  if (capture?.before.status === 'verified' && JSON.stringify(capture.before) === JSON.stringify(capture.after)) {
    try {
      const { status, ...inputs } = capture.before;
      if (inputs.selection.foundation === ASTRO &&
          (result.outputFormat !== 'Astro 6 static HTML and assets'
           || await verifyAstroOutput(attempt.output) !== result.integrity)) throw new Error('Astro publication mismatch.');
      const products = result.target === 'web' ? null : await read(attempt.output, 'products.json');
      if (!products || products.value.version === inputs.productVersion) {
        evidence = { ...base, ...inputs, status: 'verified', nativeStatus: 'success', product: 'app',
          sourceKind: 'web-app-inputs-sha256-v1', sourceId: 'web-app-inputs-sha256:' + result.inputs,
          inputs: result.inputs, integrity: result.integrity, productsSha256: products?.sha256 || null,
          ...await inventory(attempt.output) };
      }
    } catch {
      // Additional release eligibility must not redefine independent build acceptance.
      evidence = base;
    }
  }
  await fs.writeFile(path.join(attempt.staging, 'release-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
}
