import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForeground } from './fixture.mjs';
import { verifyForegroundFiles } from './evidence.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== '--project-root' || !path.isAbsolute(args[1])
    || args[2] !== '--expected-head' || !/^[a-f0-9]{40}$/.test(args[3])
    || args[4] !== '--evidence-dir' || !path.isAbsolute(args[5]))
  throw new Error('Use smoke.mjs --project-root <absolute checkout> --expected-head <revision> --evidence-dir <new absolute directory>');
if (await fs.realpath(args[1]) !== root) throw new Error('Smoke entry must belong to the explicit project checkout');
const expectedHead = args[3], output = args[5];
await fs.mkdir(output); // No shared/latest result and no overwrite of retained observations.
const controller = new AbortController();
const cancel = () => controller.abort(new Error('Foreground build cancelled'));
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let failed = false;
try {
  for (const synthetic of [false, true]) {
    let fixture, result;
    try {
      fixture = await createForeground(root, { expectedHead, synthetic, signal: controller.signal });
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
  if (!failed) {
    try {
      const handoff = await verifyForegroundFiles(root, expectedHead, output, controller.signal);
      await fs.writeFile(path.join(output, 'handoff.json'), JSON.stringify(handoff, null, 2) + '\n',
        { encoding: 'utf8', flag: 'wx' });
      console.log(JSON.stringify({ handoff }));
    } catch (error) {
      failed = true;
      console.error(JSON.stringify({ failure: { stage: 'evidence-handoff', reason: error.message } }));
    }
  }
} finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
if (failed) process.exitCode = 1;
