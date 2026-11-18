import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandMs } from '../../../tools/native-probe/limits.mjs';
import { hash } from './bootstrap.mjs';

const git = promisify(execFile);
const rootInput = /^(?:index\.html|package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\.[^.]+|\.env(?:\..*)?)$/;

// Verify the bytes Vite/TypeScript consume, independently of an after-build HEAD label.
export async function frontendSource(root, expectedHead, signal) {
  assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'Expected revision is required');
  root = await fs.realpath(root);
  async function run(args) {
    return (await git('git', args, { cwd: root, signal, windowsHide: true, timeout: commandMs })).stdout.trim();
  }
  assert.equal(await fs.realpath(await run(['rev-parse', '--show-toplevel'])), root, 'Exact project checkout required');
  assert.equal(await run(['rev-parse', 'HEAD']), expectedHead, 'Candidate revision mismatch');
  const headNames = (await run(['ls-tree', '-z', '--name-only', expectedHead])).split('\0');
  const names = [...new Set([...headNames, ...await fs.readdir(root)])].filter(name => rootInput.test(name));
  const roots = ['src', 'public', ...names].sort();
  const tree = await run(['ls-tree', '-rz', expectedHead, '--', ...roots]);
  const blobs = new Map(tree.split('\0').filter(Boolean).map(row => {
    const [metadata, name] = row.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    assert.equal(type, 'blob'); assert.ok(['100644', '100755'].includes(mode), 'No source indirection');
    return [name, oid];
  }));
  const inputs = {};
  async function visit(name) {
    const file = path.join(root, name);
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!stat) return;
    assert.ok(!stat.isSymbolicLink(), 'No frontend source indirection');
    if (stat.isDirectory()) {
      for (const child of (await fs.readdir(file)).sort()) await visit(path.posix.join(name, child));
    } else {
      assert.ok(stat.isFile(), 'Regular frontend input required');
      const bytes = await fs.readFile(file);
      const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
      assert.equal(blob, blobs.get(name), 'Frontend input differs from expected revision: ' + name);
      inputs[name] = hash(bytes);
    }
  }
  for (const name of roots) await visit(name);
  assert.deepEqual(Object.keys(inputs).sort(), [...blobs.keys()].sort(), 'Frontend input inventory mismatch');
  assert.ok(inputs['src/main.ts'] && inputs['index.html'], 'Expected frontend entry required');
  return { root, expectedHead, inputs, sha256: hash(JSON.stringify(inputs)) };
}
