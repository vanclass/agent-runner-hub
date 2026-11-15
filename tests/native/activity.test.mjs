import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSuite } from '../../tools/native-probe/suite.mjs';
import { activityCase } from './webdriver/activity.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerRoot = process.env.HUB_ACTIVITY_RUNNER_ROOT;
if (!runnerRoot || !path.isAbsolute(runnerRoot)) throw new Error('Set HUB_ACTIVITY_RUNNER_ROOT to the existing installed Runner root');
// Wide, former footer mismatch region, and narrow composer breakpoint.
nativeSuite([1280, 1000, 780].map(width => activityCase(runnerRoot, width)), {
  root, target: path.join(root, 'local/native-probe/target')
});
