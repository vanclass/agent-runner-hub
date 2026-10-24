import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { targetCatalog } from './targets.mjs';
import { executeTarget } from './execution.mjs';
import { menu, lineInput } from './menu.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../../', import.meta.url)));
const local = fileURLToPath(new URL('../.local/', import.meta.url));
const args = process.argv.slice(2);
const lines = !process.stdin.isTTY ? lineInput() : null;
let active;
const lifetime = new AbortController();
function cancel() {
  if (active) active.abort(new Error('Cancelled. Earlier verified products are preserved.'));
  else { lifetime.abort(new Error('Cancelled.')); lines?.close(); process.exitCode = 130; }
}
process.on('SIGINT', cancel);
if (process.platform === 'win32') process.on('SIGBREAK', cancel);
process.on('SIGTERM', cancel);
const stage = (name, hint) => console.log('[Build System] ' + name + '\n  ' + hint);

async function run(target, options, interactive = true) {
  active = new AbortController();
  try {
    const result = await executeTarget(root, local, target, active.signal, stage, options);
    if (result.verificationStatus === 'environment-ready') console.log('Environment ready. Choose ' + target.label + ' to build.');
    else console.log('Build succeeded — verified ' + (target.id === 'web' ? 'Web' : target.label)
      + ' product: ' + result.location + '\n  Verification: ' + result.verificationStatus);
    return true;
  } catch (error) {
    console.error('Build ' + (active.signal.aborted ? 'cancelled' : 'failed') + ': ' + error.message);
    if (!interactive) process.exitCode = active.signal.aborted ? 130 : 1;
    return false;
  } finally { active = undefined; }
}

try {
  if (!args.length) await menu(root, local, lines, run, lifetime.signal);
  else if (args[0] === '--help') {
    console.log('Web App Build System\n  --list\n  --build <target> [--prepare]\n  --prepare <target>\nWithout arguments: interactive menu (redirected line input supported).');
  } else {
    const valid = args[0] === '--list' && args.length === 1
      || args[0] === '--prepare' && args.length === 2
      || args[0] === '--build' && (args.length === 2 || args.length === 3 && args[2] === '--prepare');
    if (!valid) throw new Error('Invalid arguments. Use --help.');
    stage('Checking build readiness', 'Inspecting current project dependencies.');
    const targets = await targetCatalog(root, lifetime.signal);
    if (args[0] === '--list') console.log(JSON.stringify(targets, null, 2));
    else {
      const target = targets.find(item => item.id === args[1]);
      if (!target) throw new Error('Unknown build target: ' + args[1]);
      await run(target, { prepare: args.includes('--prepare'), prepareOnly: args[0] === '--prepare' }, false);
    }
  }
} catch (error) { console.error('Build System failed: ' + error.message); process.exitCode = lifetime.signal.aborted ? 130 : 1; }
finally { lines?.close(); if (process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdout.write('\x1b[?25h'); } }
