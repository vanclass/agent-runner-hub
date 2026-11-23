import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSuite } from './suite.mjs';
import { installationEntry } from '../../tests/native/webdriver/installation.mjs';
import { configurationSelection } from '../../tests/native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../../tests/native/webdriver/runner-read-only.mjs';
import { rendererProbe } from '../../tests/native/webdriver/probe.mjs';
import { languageCase } from '../../tests/native/webdriver/language.mjs';
import { hubLogCase } from '../../tests/native/webdriver/hub-log.mjs';
import { subagentRun } from '../../tests/native/webdriver/subagent.mjs';
import { semanticPresentation } from '../../tests/native/webdriver/terminal-presentation.mjs';
import { singleEntryIssueCase } from '../../tests/native/webdriver/single-entry-issue.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Terminal cases (retained case IDs): semantic-presentation compares original xterm scrollback/viewport and diagnostic canonical records for /help; semantic-work submits a long bilingual read-only instruction; single-entry-work checks one original instruction in its assigned terminal. All require --runner-root and use the canonical startup account/model.');
  console.log('Additional case: hub-log (requires --runner-root); checks tab-independent capture and a fresh native process with the same isolated app data.');
  console.log('IssueRun cases: native-single-entry-issue-work and native-single-entry-delayed-brief. Both require --runner-root and --issue-target <authorized registered Project ID>. Each creates one disposable IssueRun.');
  console.log('node tools/native-probe/hub.mjs [--case <id>] [--runner-root <absolute existing Runner installation>] [--target-dir <absolute Cargo cache>]\nCases: installation-entry, configuration-selection, runner-read-only, renderer-probe, language-preference, hub-log, subagent-run, semantic-presentation, semantic-work. Default: the three WG3 cases. Repeat --case for explicit composition. Runner cases reuse the ordinary authenticated startup account in a new test-owned Hub process. Select the existing installation for the fresh Hub profile. Only explicitly selected work cases may submit their declared instruction. No automatic presentation escalation.');
} else {
  const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const ids = [], values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--case', '--runner-root', '--target-dir', '--issue-target'].includes(flag) || !value) throw new Error('Use --help');
    if (flag === '--case') ids.push(value);
    else {
      if (values.has(flag) || flag !== '--issue-target' && !path.isAbsolute(value))
        throw new Error('Use one value per option and absolute paths; see --help');
      values.set(flag, flag === '--issue-target' ? value : path.resolve(value));
    }
  }
  const runnerRoot = values.get('--runner-root');
  const cases = [installationEntry, configurationSelection(runnerRoot), runnerReadOnly(runnerRoot), rendererProbe, languageCase, hubLogCase(runnerRoot), subagentRun(runnerRoot), semanticPresentation(runnerRoot)];
  cases.push(semanticPresentation(runnerRoot, root));
  cases.push(semanticPresentation(runnerRoot, root, 'single-entry'));
  cases.push(singleEntryIssueCase(runnerRoot, values.get('--issue-target'), false));
  cases.push(singleEntryIssueCase(runnerRoot, values.get('--issue-target'), true));
  const selected = ids.length ? ids.map(id => {
    const spec = cases.find(c => c.id === id);
    if (!spec) throw new Error('Unknown case: ' + id + '; see --help');
    return spec;
  }) : cases.slice(0, 3);
  nativeSuite(selected, { root, target: values.get('--target-dir') ?? path.join(root, 'local/native-probe/target') });
}
