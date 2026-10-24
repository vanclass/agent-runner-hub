import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export default class OutcomeReporter {
  onBegin() {
    console.log(`WEB_APP_TEST_ARTIFACTS ${process.env.RUNNER_WEB_APP_ARTIFACTS}`);
  }
  onTestEnd(test, result) {
    if (result.status === 'timedOut') {
      this.timedOut = true;
      console.error(`WEB_APP_TEST_TIMEOUT: ${test.title}. Inspect the trace; raise the test timeout only for an expected slow action.`);
    }
  }
  onError(error) {
    this.failure ||= error.message;
  }
  onEnd(result) {
    const codes = { passed: 'WEB_APP_TEST_PASSED', failed: 'WEB_APP_TEST_FAILED', timedout: 'WEB_APP_TEST_TIMEOUT', interrupted: 'WEB_APP_TEST_CANCELLED' };
    const artifacts = process.env.RUNNER_WEB_APP_ARTIFACTS;
    const preflight = path.join(artifacts, 'preflight-failure.json');
    const primary = existsSync(preflight) ? JSON.parse(readFileSync(preflight, 'utf8')) : undefined;
    const code = primary?.code || (this.timedOut && result.status === 'failed' ? 'WEB_APP_TEST_TIMEOUT' : codes[result.status]) || 'WEB_APP_TEST_UNKNOWN';
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(path.join(artifacts, 'outcome.json'), JSON.stringify({ code, status: result.status, failure: primary?.message || this.failure, duration: result.duration }, null, 2));
    console.log(`${code}: ${result.status}; report=${path.join(artifacts, 'report/index.html')}`);
    if (result.status === 'failed') console.error('Inspect the failing assertion, page-errors attachment and trace; fix the current checkout and rerun npm run test:e2e.');
    if (result.status === 'interrupted') console.error('Testing was cancelled; rerun npm run test:e2e when ready.');
  }
}
