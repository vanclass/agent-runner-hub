import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { treeHash } from './project.mjs';
import { writeReleaseEvidence } from './release-evidence.mjs';
import { verifyAstroOutput } from './astro-output.mjs';

export async function beginResult(local) {
  await fs.mkdir(local, { recursive: true });
  if (await fs.realpath(local) !== path.resolve(local)) throw new Error('Build System local state must be a plain tool-owned directory.');
  const id = randomUUID();
  const stagingRoot = path.join(local, 'staging');
  await fs.mkdir(stagingRoot, { recursive: true });
  if (await fs.realpath(stagingRoot) !== stagingRoot) throw new Error('Result staging cannot use filesystem indirection.');
  const staging = path.join(stagingRoot, id);
  await fs.mkdir(staging);
  return { id, staging, output: path.join(staging, 'app'), local };
}

export async function verifyOutput(output, base = '/', foundation = 'ViteVanillaTS') {
  if (foundation === 'AstroTS') return verifyAstroOutput(output);
  let javascript = 0;
  async function visit(folder) {
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Build products cannot contain filesystem indirection.');
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile() && stat.size && name.endsWith('.js')) javascript++;
    }
  }
  await visit(output);
  const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
  if (!html.trim() || !javascript) throw new Error('Output verification failed: nonempty index.html and JavaScript assets are required.');
  let scripts = 0;
  for (const match of html.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) {
    let reference = match[2].split(/[?#]/)[0];
    if (/^(https?:|data:|\/\/)/.test(reference)) continue;
    if (reference.startsWith(base)) reference = reference.slice(base.length);
    const file = path.resolve(output, '.' + path.sep + decodeURIComponent(reference.replace(/^\//, '')));
    const relative = path.relative(output, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('HTML asset reference escapes the verified output.');
    const stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size) throw new Error('Missing or empty HTML asset: ' + reference);
    if (match[1].toLowerCase() === 'script') scripts++;
  }
  if (!scripts) throw new Error('Output verification failed: index.html must reference a generated local script.');
  return treeHash(output);
}

export async function publishResult(attempt, target, integrity, inputs, capture) {
  const result = { schema: 1, id: attempt.id, target: target.id, outputFormat: target.outputFormat,
    verificationStatus: 'verified', integrity, inputs, createdAt: new Date().toISOString(), product: 'app' };
  const resultBytes = JSON.stringify(result, null, 2) + '\n';
  await fs.writeFile(path.join(attempt.staging, 'result.json'), resultBytes, { flag: 'wx' });
  await writeReleaseEvidence(attempt, result, resultBytes, capture);
  const results = path.join(attempt.local, 'results');
  await fs.mkdir(results, { recursive: true });
  if (await fs.realpath(results) !== results) throw new Error('Result publication cannot use filesystem indirection.');
  const destination = path.join(results, attempt.id);
  await fs.rename(attempt.staging, destination);
  return { ...result, location: destination };
}

export async function discardResult(attempt) {
  const backup = path.join(attempt.staging, 'previous-output');
  if (await fs.lstat(backup).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) throw new Error('Prior project output could not be restored and is preserved at ' + backup
    + '. Restore that exact output before retrying; this attempt was not published.');
  // The attempt owns this newly allocated UUID directory, never previous results.
  await fs.rm(attempt.staging, { recursive: true, force: true });
}
