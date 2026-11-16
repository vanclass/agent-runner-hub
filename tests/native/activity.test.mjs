import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSuite } from '../../tools/native-probe/suite.mjs';
import { activityCase, assertSupportedStartup } from './webdriver/activity.mjs';

test('startup Activity rejects the complete rendered unsupported sentence', () => {
  assert.throws(() => assertSupportedStartup([
    'Hub 실행 옵션을 불러오는 중…',
    'Hub 이 Runner는 설정 조회를 지원하지 않습니다.',
    'Hub 프로젝트 또는 대상을 선택하세요.'
  ]), assert.AssertionError);
  assert.doesNotThrow(() => assertSupportedStartup([
    'Hub 실행 옵션을 불러오는 중…', 'Hub 프로젝트 또는 대상을 선택하세요.'
  ]));
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerRoot = process.env.HUB_ACTIVITY_RUNNER_ROOT;
if (!runnerRoot || !path.isAbsolute(runnerRoot)) throw new Error('Set HUB_ACTIVITY_RUNNER_ROOT to the existing installed Runner root');
// Wide, former footer mismatch region, and narrow composer breakpoint.
nativeSuite([1280, 1000, 780].map(width => activityCase(runnerRoot, width)), {
  root, target: path.join(root, 'local/native-probe/target')
});
