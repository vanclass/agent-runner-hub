# IssueRun Candidate Report

## Task Info
- Task Number: 110
- Task Title: Improve shared settings and restore last selections
- Task Title (KR): 설정 패널과 마지막 선택 복원 동작 개선
- Summary: Implemented and browser-validated R01–R08: account-first shared settings, readable mode dropdown, conditional destination, saved-choice precedence, current-Runner initialization and reuse in App Settings. Candidate awaits independent Runner validation and Review.
- Summary (KR): R01–R08의 공용 설정 배치, 모드 드롭다운, 조건부 입력, 저장값 우선 복원과 연결 Runner 초기화, 앱 설정의 유휴 재사용을 구현하고 브라우저에서 검증했다. Runner의 독립 검증과 Review가 남아 있다.

## Work
- Plan: preserve stored requests and wire IDs; initialize new choices through verified current-account inspection; arrange account, mode and conditional destination, then model; move reuse to App Settings through the existing selection writer. Validate focused browser flows and update their existing specifications.
- Completed: shared settings now show Account → mode dropdown → Target or Direct Root → Model/Reasoning/Fast. Removed Advanced Settings and the mode's Runner-default control; project labels omit the protocol prefix. The display-only runModeLabel module preserves wire IDs and supports the successor's display responsibility.
- Ownership/model: HubSelections retains requested state and its single save path; HubPreferences retains persistence. Existing procedural inspection with source/edit fences was retained instead of introducing another state owner or copying RunnerControl. A narrow observation supplier provides fresh current-account evidence; restored partial, unsupported and initialized-clear requests stay authoritative. Display labels derive from IDs without a synchronized display-state copy. Mode changes, restoration and submission retain canonical values; unrelated editor/clipboard/history operations are unaffected.
- App Settings receives only reuse value/editability/callback from Hub. SingleEntry still consumes allocationPolicy and owns pending locks and existing eligibility/reservation rules. No duplicate preference, broad owner injection or compatibility wrapper was added. Existing composition roots and runtime/configuration owners were retained.
- Specification decision: updated the existing hub_preferences.md and runner_session_config.md owners, the directly affected runner_terminals.md allocation summary and the root index's initialization-test route. No new specification owner was needed. Semantic review confirmed preserved wire conversion, destination-account validation and request/actual/effective/next separation.

## Validation
- npm run build: passed after an offline npm ci --ignore-scripts restored missing checkout dependencies. The initial build could not locate tsc. Existing large-chunk warning remains informational.
- npm run test:i18n: passed (catalog integrity and negative cases). Removed the obsolete Advanced Settings key after its unused-key failure.
- Initialization/persistence: 30 focused checks passed. Two additional current-second-account/non-first-model and unavailable-fresh-observation checks passed. Explicit Direct Root validation passed separately after selecting Direct mode in its fixture.
- First UI batch: 47 checks passed, then the existing 120-second suite budget expired with 10 not run; teardown also reported timeout. The captured server PID was absent and its loopback endpoint was independently observed closed afterward. This aggregate remains timed out.
- Smaller panel/reuse batch: seven passed and five assertions failed. The failures were test-side option-disabled semantics and counting DirectoryInput's setting wrapper as a select. Corrected those assertions; all five affected checks passed, including English/Korean × Light/Black and narrow overlays. Existing passing checks cover conditional Root retention, Fast and independent tab requests, blocked plans, persisted selection delivery, and eligible reuse followed by always-new.
- Directory regression: five passed, covering manual allocation and localized directory controls in both themes. UI captures and action assertions are distinct evidence; inspected desktop English/Light and narrow Korean/Black captures showed readable account-first controls without overflow.
- LF/no-BOM, UTF-8 readability, unchanged Korean comments, localized source diffs and git diff --check passed. No native or real-Provider claim is inferred from synthetic native transport and headless Chromium.
- Immutable invocation diagnostics contain the command logs, original failed/timed outcomes, corrected passes, browser/server identities and HTML reports/captures. Product observations are separately bound in worker_execution_result.json.

## Review
- R01–R08 are implemented and supported by current-Candidate browser observations; no assigned obligation remains blocked. No planning revision is requested. Runner owns independent validation, Review, staging, commit and publication; this report does not claim whole-IssueRun completion.
- Native WebView, packaged-product behavior, real Runner/Provider performance and other platforms were not exercised. Existing protocol, allocation eligibility, process lifecycle and native permissions were not changed.
- The exact frozen AgentRunnerHub project policy index was absent; common policies and the existing project specification index were used. No Workspace policy was modified.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-44","work_group_id":"WG01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
