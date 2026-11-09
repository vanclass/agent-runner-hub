import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSuite } from './suite.mjs';
import { installationEntry } from '../../tests/native/webdriver/installation.mjs';
import { configurationSelection } from '../../tests/native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../../tests/native/webdriver/runner-read-only.mjs';
import { rendererProbe } from '../../tests/native/webdriver/probe.mjs';
import { languageCase } from '../../tests/native/webdriver/language.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('node tools/native-probe/hub.mjs [--case <id>] [--isolated-runner-root <absolute dedicated installed Runner>] [--target-dir <absolute Cargo cache>]\nCases: installation-entry, configuration-selection, runner-read-only, renderer-probe, language-preference. Default: the three WG3 cases. Repeat --case for explicit composition. Runner cases block without isolated installation and saved Test account prerequisites. No work is submitted; no automatic presentation escalation.');
} else {
  const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const ids = [], values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--case', '--isolated-runner-root', '--target-dir'].includes(flag) || !value) throw new Error('Use --help');
    if (flag === '--case') ids.push(value);
    else {
      if (values.has(flag) || !path.isAbsolute(value)) throw new Error('Use one absolute path per option; see --help');
      values.set(flag, path.resolve(value));
    }
  }
  const runnerRoot = values.get('--isolated-runner-root');
  const cases = [installationEntry, configurationSelection(runnerRoot), runnerReadOnly(runnerRoot), rendererProbe, languageCase];
  const selected = ids.length ? ids.map(id => {
    const spec = cases.find(c => c.id === id);
    if (!spec) throw new Error('Unknown case: ' + id + '; see --help');
    return spec;
  }) : cases.slice(0, 3);
  nativeSuite(selected, { root, target: values.get('--target-dir') ?? path.join(root, 'local/native-probe/target') });
}
