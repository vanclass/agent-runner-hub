import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { frontendSource } from './source.mjs';
import { commandMs } from '../../../tools/native-probe/limits.mjs';

test('frontend identity binds exact checkout/revision and rejects changed, missing and added build inputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-fg-source-'));
  const signal = new AbortController().signal;
  function git(...args) {
    return execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: commandMs }).trim();
  }
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'public'));
    const original = 'export const revision = "expected";\n';
    await fs.writeFile(path.join(root, 'src/main.ts'), original);
    await fs.writeFile(path.join(root, 'index.html'), '<head></head>');
    await fs.writeFile(path.join(root, 'vite.config.ts'), 'export default {};\n');
    git('init', '--quiet');
    git('-c', 'core.autocrlf=false', 'add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    const head = git('rev-parse', 'HEAD');
    const before = await frontendSource(root, head, signal);
    assert.ok(before.inputs['src/main.ts']);
    await assert.rejects(frontendSource(root, '0'.repeat(40), signal), /Candidate revision mismatch/);
    await assert.rejects(frontendSource(path.join(root, 'src'), head, signal), /Exact project checkout required/);
    await fs.writeFile(path.join(root, 'src/main.ts'), 'export const revision = "changed";\n');
    await assert.rejects(frontendSource(root, head, signal), /Frontend input differs/);
    await fs.writeFile(path.join(root, 'src/main.ts'), original);
    await fs.unlink(path.join(root, 'vite.config.ts'));
    await assert.rejects(frontendSource(root, head, signal), /Frontend input inventory mismatch/);
    await fs.writeFile(path.join(root, 'vite.config.ts'), 'export default {};\n');
    await fs.writeFile(path.join(root, 'public/untracked.js'), 'unexpected');
    await assert.rejects(frontendSource(root, head, signal), /Frontend input differs/);
    await fs.unlink(path.join(root, 'public/untracked.js'));
    assert.deepEqual(await frontendSource(root, head, signal), before);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    await fs.rm(root, { recursive: true });
  }
});
