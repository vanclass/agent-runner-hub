import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { targetCatalog, targetDefinitions } from './targets.mjs';
import { executeTarget, PreparationBlocked, settings } from './execution.mjs';
import { updateLocalSettings } from './local-settings.mjs';
import { menu, lineInput } from './menu.mjs';
import { certificateCli } from './signing/menu.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
const local = fileURLToPath(new URL('../local/', import.meta.url));
const args = process.argv.slice(2);
const resultFileIndex = args.indexOf('--result-file');
const resultFile = resultFileIndex === -1 ? undefined : args[resultFileIndex + 1];
if (resultFileIndex !== -1) {
  if (args[0] !== '--build' || resultFileIndex !== 2 || args.length !== 4 || !resultFile) {
    throw new Error('Use --build <target> --result-file <invocation-path>.');
  }
  args.splice(resultFileIndex, 2);
}
const lines = !process.stdin.isTTY || !process.stdout.isTTY ? lineInput() : null;
let active;
const lifetime = new AbortController();
function cancel() {
  if (active) active.abort(new Error('Cancelled. Earlier verified products are preserved.'));
  else { lifetime.abort(new Error('Cancelled.')); lines?.close(); process.exitCode = 130; }
}
const cancelFile = process.env.BUILDWEAVE_CANCEL_FILE;
const cancelWatcher = cancelFile && setInterval(() => { if (existsSync(cancelFile)) cancel(); }, 100).unref();
process.on('SIGINT', cancel);
if (process.platform === 'win32') process.on('SIGBREAK', cancel);
process.on('SIGTERM', cancel);
const stage = (name, hint, id) => {
  if (id && process.env.BUILDWEAVE_ACTIVITY === '1') {
    console.log('@buildweave-activity ' + JSON.stringify({ stage: id }));
  }
  console.log('[Build System] ' + name + '\n  ' + hint);
};

async function run(target, options, interactive = true) {
  lifetime.signal.throwIfAborted();
  active = new AbortController();
  try {
    const result = await executeTarget(root, local, target, active.signal, stage, { ...options, resultFile });
    if (result.verificationStatus === 'environment-ready') {
      console.log(options.automatic ? 'Environment ready: ' + target.label
        : 'Environment ready. Choose ' + target.label + ' to build.');
    } else console.log('Build succeeded — verified ' + (target.id === 'web' ? 'Web' : target.label)
      + ' product: ' + result.location + '\n  Verification: ' + result.verificationStatus);
    return true;
  } catch (error) {
    const blocked = error instanceof PreparationBlocked;
    const state = active.signal.aborted ? 'cancelled' : blocked ? 'blocked' : 'failed';
    console.error('Build ' + state + ': ' + error.message);
    if (!interactive) process.exitCode = active.signal.aborted ? 130 : blocked ? 2 : 1;
    return false;
  } finally { active = undefined; }
}

try {
  if (!args.length) await menu(root, local, lines, run, lifetime.signal);
  else if (args[0] === '--help') {
    console.log('Web App Build System\n  --list\n  --build <target> [--prepare]\n  --prepare <target>\n  --certificate list | status | remove\n  --certificate select <thumbprint> <RFC3161-url>\nWithout arguments: interactive menu (redirected line input supported).');
  } else if (args[0] === '--targets-json' && args.length === 1) {
    console.log(JSON.stringify(await targetCatalog(root, lifetime.signal)));
  } else if (args[0] === '--desktop-targets' && args.length === 2) {
    const { allowDependencyInstall } = await settings(local);
    console.log(JSON.stringify(await targetCatalog(root, lifetime.signal, {
      selected: args[1], allowInstall: allowDependencyInstall,
    })));
  } else if (resultFile || args[0] === '--desktop-prepare' && args.length === 2) {
    stage('Checking build readiness', 'Inspecting the selected target dependencies.');
    const target = (await targetDefinitions(root)).find(item => item.id === args[1]);
    if (!target) throw new Error('Unknown build target: ' + args[1]);
    const automatic = args[0] === '--desktop-prepare';
    if (automatic) process.env.npm_config_ignore_scripts = 'true';
    await run(target, { automatic, prepareOnly: automatic }, false);
  } else if (args[0] === '--settings-json' && args.length === 1) {
    console.log(JSON.stringify({ allowDependencyInstall: (await settings(local)).allowDependencyInstall }));
  } else if (args[0] === '--dependency-install' && args.length === 2 && ['on', 'off'].includes(args[1])) {
    await updateLocalSettings(root, local, lifetime.signal, value => {
      value.allowDependencyInstall = args[1] === 'on';
    });
  } else if (args[0] === '--certificate') {
    stage('Checking certificate settings', 'Using this project’s selection and CurrentUser Personal store.');
    console.log(JSON.stringify(await certificateCli(root, local, args, lifetime.signal), null, 2));
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
finally { if (cancelWatcher) clearInterval(cancelWatcher); lines?.close(); }
