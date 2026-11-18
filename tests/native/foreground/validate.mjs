import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { command } from '../../../.project-config/managed/web-app-tauri/native/process.mjs';
import { commandMs } from '../../../tools/native-probe/limits.mjs';
import { verifyForegroundFiles } from './evidence.mjs';

// Runner supplies the admitted validation checkout as CWD. Every replay records a fresh attempt.
const root = await fs.realpath(process.cwd());
assert.equal(root, await fs.realpath(fileURLToPath(new URL('../../../', import.meta.url))));
const expectedHead = execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: commandMs }).trim();
const parent = path.join(root, 'temp/native-foreground-validation');
await fs.mkdir(parent, { recursive: true });
const folder = path.join(parent, randomUUID());
const signal = new AbortController().signal;
const result = await command(process.execPath, ['tests/native/foreground/smoke.mjs',
  '--project-root', root, '--expected-head', expectedHead, '--evidence-dir', folder], root, signal, { quiet: false });
assert.equal(result.code, 0, 'Foreground smoke failed; retain its scoped failure evidence at ' + folder);
console.log(JSON.stringify({ verifiedHandoff: await verifyForegroundFiles(root, expectedHead, folder, signal) }));
