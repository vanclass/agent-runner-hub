import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(process.cwd());
if (root !== realpathSync(fileURLToPath(new URL('../../', import.meta.url)))) {
  throw new Error('WEB_APP_CHECKOUT_MISMATCH: Run npm run test:e2e in this checkout; shared or foreign configuration is unsupported.');
}
process.env.RUNNER_WEB_APP_TEST_ID ||= randomUUID();
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(process.env.RUNNER_WEB_APP_TEST_ID)) {
  throw new Error('WEB_APP_ARTIFACT_ID_INVALID: Clear RUNNER_WEB_APP_TEST_ID and rerun npm run test:e2e.');
}
const artifacts = path.join(root, 'test-results/web-app', process.env.RUNNER_WEB_APP_TEST_ID);
process.env.RUNNER_WEB_APP_ARTIFACTS = artifacts;
process.env.RUNNER_WEB_APP_REACT = String(existsSync(path.join(root, 'src/frameworks/react.tsx')));
process.env.RUNNER_WEB_APP_PHASER = String(existsSync(path.join(root, 'src/frameworks/phaser.ts')));

export default defineConfig({
  testDir: path.join(root, 'tests/e2e'),
  outputDir: path.join(artifacts, 'results'),
  globalSetup: fileURLToPath(new URL('./setup.mjs', import.meta.url)),
  // 전체 실행 제한 시간이다. 늘리면 느린 실행을 더 기다리고, 줄이면 더 빨리 중단한다.
  globalTimeout: 120_000,
  // 개별 테스트 제한 시간이다. 늘리면 느린 동작을 허용하고, 줄이면 정지 원인을 빨리 드러낸다.
  timeout: 30_000,
  // 기대 조건 대기 시간이다. 늘리면 지연을 더 허용하고, 줄이면 실패를 빨리 알린다.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  // 동시 작업 수다. 늘리면 병렬성과 자원 사용이 늘고, 줄이면 자원 경쟁이 줄어든다.
  workers: 2,
  reporter: [
    ['list'],
    [fileURLToPath(new URL('./reporter.mjs', import.meta.url))],
    ['html', { outputFolder: path.join(artifacts, 'report'), open: 'never' }],
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } }],
  use: {
    headless: true,
    // 화면 크기다. 늘리면 더 넓은 배치를 검사하고, 줄이면 좁은 화면의 배치를 검사한다.
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 입력 동작 대기 시간이다. 늘리면 느린 반응을 기다리고, 줄이면 입력 실패를 빨리 알린다.
    actionTimeout: 10_000,
    // 탐색 대기 시간이다. 늘리면 느린 로딩을 허용하고, 줄이면 탐색 실패를 빨리 알린다.
    navigationTimeout: 15_000,
  },
});
