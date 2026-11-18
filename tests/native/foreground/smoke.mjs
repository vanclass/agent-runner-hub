import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForeground } from './fixture.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--evidence-dir' || !path.isAbsolute(args[1]))
  throw new Error('Use node tests/native/foreground/smoke.mjs --evidence-dir <new absolute evidence directory>');
const output = args[1];
await fs.mkdir(output); // No shared/latest result and no overwrite of retained observations.
const controller = new AbortController();
const cancel = () => controller.abort(new Error('Foreground build cancelled'));
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let failed = false;
try {
  for (const synthetic of [false, true]) {
    let fixture, result;
    try {
      fixture = await createForeground(root, { synthetic, signal: controller.signal });
      result = fixture.evidence;
      await fixture.close();
      result.outcome = 'passed';
    } catch (error) {
      result = error.evidence ?? fixture?.evidence ?? { failure: { stage: 'setup', reason: error.message } };
      result.outcome = 'blocked'; failed = true;
    }
    const file = path.join(output, (synthetic ? 'synthetic' : 'plain') + '.json');
    await fs.writeFile(file, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ mode: synthetic ? 'synthetic' : 'plain', outcome: result.outcome, file, failure: result.failure }));
    if (result.cleanupFailure || result.settlement && !result.profileRemoved) break;
  }
} finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
if (failed) process.exitCode = 1;
