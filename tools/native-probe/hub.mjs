import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSuite } from './suite.mjs';
import { installationEntry } from '../../tests/native/webdriver/installation.mjs';
import { configurationSelection, configurationPresentation } from '../../tests/native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../../tests/native/webdriver/runner-read-only.mjs';
import { rendererProbe } from '../../tests/native/webdriver/probe.mjs';
import { languageCase } from '../../tests/native/webdriver/language.mjs';
import { hubLogCase } from '../../tests/native/webdriver/hub-log.mjs';
import { subagentRun } from '../../tests/native/webdriver/subagent.mjs';
import { semanticPresentation } from '../../tests/native/webdriver/terminal-presentation.mjs';
import { semanticWorkCase } from '../../tests/native/webdriver/semantic-work.mjs';
import { singleEntryIssueCase } from '../../tests/native/webdriver/single-entry-issue.mjs';
import { issueSidebarLifecycle } from '../../tests/native/webdriver/issue-sidebar-lifecycle.mjs';
import { domInteractions } from '../../tests/native/webdriver/dom-interactions.mjs';
import { attachmentWorkCase } from '../../tests/native/webdriver/attachment-work.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Background work: semantic-work and single-entry-work submit one harmless instruction each. Add -presentation to either ID for its separate displayed terminal and composer checks. semantic-presentation checks /help and rejected command output. These cases require --runner-root.');
  console.log('Presentation and interaction cases: configuration-presentation requires --runner-root; dom-interactions checks synthetic DOM primitives in a hidden Hub without Runner.');
  console.log('Additional case: hub-log (requires --runner-root); checks tab-independent capture and a fresh native process with the same isolated app data.');
  console.log('Background attachment-work (requires --runner-root): submits one harmless instruction with an image through the selected Runner composer.');
  console.log('IssueRun cases: native-single-entry-issue-work and native-single-entry-delayed-brief. Both require --runner-root and --issue-target <authorized registered Project ID>. Each creates one disposable IssueRun.');
  console.log('issue-sidebar-lifecycle: requires --producer-source <absolute local Git repository>; uses a fresh scripted Discussion fixture from the accepted producer revision.');
  console.log('node tools/native-probe/hub.mjs [--case <id>] [--runner-root <absolute existing Runner installation>] [--target-dir <absolute Cargo cache>]\nCases: installation-entry, configuration-selection, runner-read-only, renderer-probe, language-preference, hub-log, subagent-run, semantic-presentation, semantic-work. Default: the three WG3 cases. Repeat --case for explicit composition. Runner cases reuse the ordinary authenticated startup account in a new test-owned Hub process. Select the existing installation for the fresh Hub profile. Only explicitly selected work cases may submit their declared instruction. No automatic presentation escalation.');
} else {
  const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const ids = [], values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--case', '--runner-root', '--target-dir', '--issue-target', '--producer-source'].includes(flag) || !value) throw new Error('Use --help');
    if (flag === '--case') ids.push(value);
    else {
      if (values.has(flag) || flag !== '--issue-target' && !path.isAbsolute(value))
        throw new Error('Use one value per option and absolute paths; see --help');
      values.set(flag, flag === '--issue-target' ? value : path.resolve(value));
    }
  }
  const runnerRoot = values.get('--runner-root');
  const cases = [installationEntry, configurationSelection(runnerRoot, root), runnerReadOnly(runnerRoot),
    rendererProbe, languageCase, hubLogCase(runnerRoot), subagentRun(runnerRoot), semanticPresentation(runnerRoot),
    configurationPresentation(runnerRoot), domInteractions];
  for (const surface of ['runner', 'single-entry']) {
    cases.push(semanticWorkCase(runnerRoot, root, surface));
    cases.push(semanticWorkCase(runnerRoot, root, surface, true));
  }
  cases.push(singleEntryIssueCase(runnerRoot, values.get('--issue-target'), false));
  cases.push(singleEntryIssueCase(runnerRoot, values.get('--issue-target'), true));
  cases.push(issueSidebarLifecycle(values.get('--producer-source')));
  cases.push(attachmentWorkCase(runnerRoot, root));
  const selected = ids.length ? ids.map(id => {
    const spec = cases.find(c => c.id === id);
    if (!spec) throw new Error('Unknown case: ' + id + '; see --help');
    return spec;
  }) : cases.slice(0, 3);
  nativeSuite(selected, { root, target: values.get('--target-dir') ?? path.join(root, 'local/native-probe/target') });
}
