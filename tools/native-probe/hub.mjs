import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSuite } from './suite.mjs';
import { installationEntry } from '../../tests/native/webdriver/installation.mjs';
import { configurationSelection, configurationPresentation } from '../../tests/native/webdriver/configuration.mjs';
import { runnerReadOnly } from '../../tests/native/webdriver/runner-read-only.mjs';
import { rendererProbe } from '../../tests/native/webdriver/probe.mjs';
import { languageCase } from '../../tests/native/webdriver/language.mjs';
import { notificationSoundsCase, notificationSoundEventsCase } from '../../tests/native/webdriver/notification-sounds.mjs';
import { hubLogCase } from '../../tests/native/webdriver/hub-log.mjs';
import { subagentRun } from '../../tests/native/webdriver/subagent.mjs';
import { terminalCommands } from '../../tests/native/webdriver/terminal-presentation.mjs';
import { semanticWorkCase } from '../../tests/native/webdriver/semantic-work.mjs';
import { singleEntryIssueCase } from '../../tests/native/webdriver/single-entry-issue.mjs';
import { issueSidebarLifecycle } from '../../tests/native/webdriver/issue-sidebar-lifecycle.mjs';
import { domInteractions } from '../../tests/native/webdriver/dom-interactions.mjs';
import { attachmentWorkCase } from '../../tests/native/webdriver/attachment-work.mjs';
import { backgroundWorkspace } from '../../tests/native/webdriver/background-workspace.mjs';
import { providerSwitchCase } from '../../tests/native/webdriver/provider-switch.mjs';
import { menuPresentation } from '../../tests/native/webdriver/menu-presentation.mjs';
import { quickSettings } from '../../tests/native/webdriver/quick-settings.mjs';

export async function runProbe(args, { smoke = false } = {}) {
  const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const help = args.length === 1 && args[0] === '--help';
  const ids = [], values = new Map();
  for (let i = 0; !help && i < args.length; i += 2) {
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
  const defaults = [installationEntry, configurationSelection(runnerRoot, root), runnerReadOnly(runnerRoot)];
  const languagePresentation = languageCase(true);
  const cases = [...defaults, rendererProbe, languageCase(), languagePresentation,
    hubLogCase(runnerRoot), hubLogCase(runnerRoot, true), subagentRun(runnerRoot), terminalCommands(runnerRoot), terminalCommands(runnerRoot, true),
    configurationPresentation(runnerRoot), domInteractions, notificationSoundsCase, notificationSoundEventsCase(runnerRoot)];
  for (const surface of ['runner', 'single-entry']) {
    cases.push(semanticWorkCase(runnerRoot, root, surface));
    cases.push(semanticWorkCase(runnerRoot, root, surface, true));
  }
  cases.push(singleEntryIssueCase(runnerRoot, values.get('--issue-target'), false));
  cases.push(singleEntryIssueCase(runnerRoot, values.get('--issue-target'), true));
  cases.push(issueSidebarLifecycle(values.get('--producer-source')));
  cases.push(attachmentWorkCase(runnerRoot, root));
  cases.push(backgroundWorkspace(runnerRoot));
  cases.push(menuPresentation(runnerRoot));
  cases.push(quickSettings(runnerRoot));
  cases.push(semanticWorkCase(runnerRoot, root, 'runner-quick'));
  cases.push(providerSwitchCase(runnerRoot));
  cases.push(providerSwitchCase(runnerRoot, root));
  if (help) {
    console.log('npm run test:native:probe -- [--case <id>] [--runner-root <absolute existing Runner installation>] [--target-dir <absolute Cargo cache>]');
    console.log('Repeat --case to select cases. Without selectors the npm entry runs the displayed smoke cases; the direct hub.mjs entry runs the installation/configuration/read-only cases.');
    for (const spec of cases) console.log('  ' + spec.id + ' (' + spec.presentation + ')');
    console.log('See tools/native-probe/README.md for case prerequisites and Provider work effects.');
    return;
  }
  const selected = ids.length ? ids.map(id => {
    const spec = cases.find(c => c.id === id);
    if (!spec) throw new Error('Unknown case: ' + id + '; see --help');
    return spec;
  }) : smoke ? [rendererProbe, languagePresentation] : defaults;
  nativeSuite(selected, { root, target: values.get('--target-dir') ?? path.join(root, 'local/native-probe/target') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runProbe(process.argv.slice(2));
}
