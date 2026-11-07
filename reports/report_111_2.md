# IssueRun Candidate Report

## Task Info
- Task Number: 111
- Task Title: Preserve verified starts when completion is unknown
- Task Title (KR): 실행 이력 기반 도메인과 러너 탭 정렬 구현
- Summary: Fixed F01/F02: confirmed starts with unknown completion now retain mode history and current-tab affinity across reload; uncertainty and conflict safety remain intact.
- Summary (KR): F01/F02 수정: 완료 결과가 미상이어도 확인된 시작의 모드 이력과 현재 탭 소속을 재시작 뒤 보존하며, 미상 결과와 관측 충돌의 안전 경계는 유지한다.

## Work
- Plan: Keep RunnerWork's outcome uncertainty/reuse safety intact; expose validated start evidence to navigation, preserve conflict/presentation fences, and verify domain, affinity and reload retention through existing fixtures.
- Implemented: RunnerWork remains the single observation-validation owner. An attempt-scoped weak confirmation set is updated only by validated upsert and cleared on conflicts; navigation consumes that public fact instead of equating outcome uncertainty with an unconfirmed start. No persistent work state, duplicate Hub logic, polling or transport was added.
- Model: Kept the existing procedural observation flow and persisted presentation model. Removing the uncertainty guard alone would promote conflicting observations; clearing uncertainty would weaken activity/reuse safety. Both alternatives were rejected.
- Tests: Existing WorkFixture exercises API/terminal unknown outcomes for all four modes, admission-only/unconfirmed negatives, conflict rejection, duplicate handling, current affinity and storage restoration. Existing hidden-presentation test now includes unknown completion. Production Hub/Sidebar fixture observes unconfirmed exclusion, a first unknown Issue Run start, movement from an older Task Run domain and reload retention.
- Specification: Updated the existing canonical docs/implementation_specs/runner_navigation.md execution-history paragraph; its index route and representative test paths remain accurate. No new specification was needed.

## Validation
- PASS: npm run build; npm run test:i18n (English/Korean catalog checks).
- PASS: navigation.spec.mjs + work-discovery.spec.mjs: 35 tests in run 474c9431-1c78-422b-b23b-543bb9fa32bf, including all new state regressions.
- Focused production browser run 261a1244-bf40-46b9-9667-a57b25aa112d: 13 passed, 2 failed. Both navigation UI tests passed; mouse insertion/reordering, cancellation/live affinity changes, domain-local add/menu placement, UUID/process/draft identity, keyboard order, promotion and English/Korean Light/Black captures were verified. Inspected rendered unknown-outcome and insertion screenshots.
- The two discovery failures are the retained predecessor foreground-composer assertions at runner-work-discovery.mjs:124 and :140. The unchanged structured-interaction contract disables that composer; separate discovery, unknown-status and navigation checks pass. These failures remain failed, outside this correction's start-evidence delta.
- Broader run cf726926-59bc-4d72-a633-a3d150a9bfcc: 68 passed, 3 failed, 36 did not run; aggregate timed out at its configured override. Failures: obsolete task-run button selectors at composer-attachments.mjs:79 and brief-submission.mjs:87; Brief Run's work-request array assertion at brief-submission.mjs:35 includes the existing work.list discovery request. None exercises the new start-confirmation branch. Kept these failures without unrelated fixture changes. Missing timeout teardown receipt remains unverified; the exact owned listener probe received no response. Later focused/state runs have closed-server receipts.
- Source integrity: localized LF/no-BOM edits, unchanged protected report identity and Korean title, no source-comment corruption, and git diff --check verified. Workspace Project policy index was absent for the exact AgentRunnerHub Target; no project-specific policy body was substituted.
- Evidence: Invocation-owned diagnostics/browser-evidence.zip, diagnostic logs and validation-review.json retain actual results, failure traces and screenshots. No installed Runner, Provider or native WebView execution is claimed.

## Review
- F01 and F02 from review a32ace59b4dedb8594e51943176db3d79b105019f20084c0fbf5c84915a6b9f5 addressed. R09/R10/R11 assigned outcomes are supported within the declared browser/synthetic boundary; R02/R03/R04/R07 remain preserved constraints, not additional completion claims.
- Independent Revision Review remains required. Runner owns admission, staging, commit and publication; source HEAD is unchanged and no IssueRun state was mutated. No planning reconsideration is requested for this in-scope repair.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-44","work_group_id":"WG02","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
