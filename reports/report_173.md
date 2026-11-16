# Session Report

## 1. Task Info
- Task Number: 173
- Task Title: Bound Runner presentation release during session shutdown
- Task Title (KR): Runner 종료 시 프레젠테이션 해제 대기 제한
- Summary: Prevent stalled semantic requests from delaying canonical PTY termination while preserving normal unsubscribe ordering and retired-session isolation.
- Summary (KR): 의미적 요청 지연이 PTY 종료를 막지 않도록 하고 정상 구독 해제 순서와 세션 격리를 유지한다.

## 2. Work Plan
- Trace presentation/session close ownership and preserve WG2 rendering, history, incomplete-delivery and authenticated control contracts.
- Bound presentation release within its existing owner, fence late responses, and retain canonical session close/dispose outcomes.
- Add withheld-response, normal ordering, failure and repeat-close regressions; run focused browser/control/process tests and supported Windows installed-Runner shutdown acceptance.

## 3. Work Summary
- RunnerPresentation now retires local binding/activity immediately, fences late subscribe/read responses and notifications, and attempts known-subscription unsubscribe once with a deadline of one existing polling interval (normally 500 ms). Release no longer joins an unresponsive presentation read or waits for the full native transport timeout.
- Existing RunnerSession closeTab/dispose integration remains the canonical process owner: both await bounded presentation release, then request PTY shutdown. Responsive release still completes before PTY close. No transport, supervisor, retry, persistence, control/work/recovery or WG2 rendering contract was introduced or changed.
- Added 14 session integration cases in tests/e2e/runner-tab-races.mjs covering withheld subscribe/read/unsubscribe, failures at each operation, normal ordering, repeated close/dispose and late response isolation. Existing history and incomplete-delivery behavior are retained.
- Specification decision: updated the existing Semantic Runner output owner in docs/implementation_specs/runner_terminals.md with bounded release and late-reply retirement; root routing remains accurate. No new specification is needed. The exact Workspace Project policy index for AgentRunnerHub was absent.

## 4. Validation Evidence
- Reproduction: temporarily reinstating the original await-running dependency caused the withheld-read close check to fail its two-second deadline; it completed only after the fixture released the reply. Evidence: test-results/web-app/cd337cec-159d-4b02-a5ae-936c6f34d2d9. The correction was restored afterward.
- Final focused browser run: 20 passed, including all 14 new close/dispose cases, presentation generation/fallback/fragment/gap/pump checks and the semantic viewport. Evidence: test-results/web-app/dad8efb7-1964-49d5-b2e7-c20e60c9d4a2. Withheld replies are released only after checking completion and PTY close; retired state remains unchanged afterward.
- Removal regression run: 41 passed and 10 failed (test-results/web-app/3f724306-072a-419e-a771-881abfc584b0). The broader control/removal attempt passed 83 cases, failed one slash unsent-log assertion, then hit its 120-second suite budget with 55 unrun (test-results/web-app/6347c8d9-8cb7-467a-ac4f-dae9159f6821). These aggregates are not passing suites.
- Failure relevance: all 11 failing cases reproduced with RunnerPresentation.ts restored byte-for-byte to Git HEAD, verified by git diff --exit-code, in test-results/web-app/ac1a59e1-06c1-4c50-a102-162926cfe256. Failures involve ambiguous App settings/Help selectors, existing row/log assertions and the absent unsent Hub-log record under terminal fallback; they do not depend on semantic release. Unrelated production/fixture repairs were left outside scope. Final corrected source was restored and the focused run above passed.
- Windows supported native path: node tools/hub-native.mjs test --test-filter desktop_terminal::pty::tests --target-dir D:/Codex/codex_workspace/agent_runner/local/native-probe/target passed TypeScript/Vite build and Cargo check; PTY fixtures: 4 passed, 11 acceptance/child tests ignored. The exact Cargo-produced unit executable then passed all 71 desktop_terminal::pty::control::tests cases, including presentation timeout, generation, correlation and independent control.
- Installed-Runner acceptance: the same exact native executable passed desktop_terminal::pty::tests::installed_runners_independent_and_owned_shutdown --exact --ignored --nocapture with HUB_RUNNER_ACCEPTANCE_ROOT=D:/Codex/codex_workspace. It verified independent installed sessions, individual owned termination, empty jobs on window shutdown, and survival of an unrelated fixture. This is actual Windows Runner acceptance, distinct from synthetic fixtures.
- Actual Windows Hub acceptance: node tools/native-probe/hub.mjs --case semantic-presentation --runner-root D:/Codex/codex_workspace --target-dir D:/Codex/codex_workspace/agent_runner/local/native-probe/target passed. Retained evidence: temp/native-probe/a2d4cb73-4c06-4585-aac5-e13dbcf28773/semantic-presentation/evidence.json. Authenticated startup logs, /help completion and semantic error output were observed; teardown stopped normally with exitCode 0, forced=false, listenerReleased=true, resourcesReleased=true and no activation. A withheld native reply was exercised by browser fixtures, not injected into this installed Runner.
- Reverse contract review: unchanged native private-pipe authentication/generation, PTY/Job cleanup, terminal parsing/history, partial-log evidence and session-close outcome owners. Modified text remains LF without BOM or replacement characters; git diff --check passed. No Runner-owned report-validation or task-end gates were run.

## 5. User Verification Message
- The shutdown correction and focused/native acceptance passed. A stalled semantic request no longer holds PTY close behind the transport timeout; responsive unsubscribe retains normal ordering. Broader browser regressions retain 11 independently reproduced pre-existing failures described above, so no fully green regression-suite claim is made. No additional manual verification is required for the exercised Windows shutdown boundary.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"173","task_workload_id":"442a6cfdce7d476fa51ac9ddd3e06056"}
<!-- TASK_END_RUNTIME_METADATA_END -->
