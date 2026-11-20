# IssueRun Candidate Report

## Task Info
- Task Number: 235
- Task Title: Distinguish the current backdrop callback during rerender
- Task Title (KR): 이미지 뷰어와 대화상자 배경 클릭 닫기
- Summary: Repair the rejected callback coverage with an isolated fixture using the real dialog hook.
- Summary (KR): 실제 대화상자 훅을 사용하는 독립 테스트로 콜백 변경 검증을 보완한다.

## Work
- Pre-implementation plan: Add a narrow browser fixture using the production hook. Begin an outside press, replace the dismissal callback with a distinguishable effect, then release and assert only the replacement ran. Reuse the existing owned Playwright fixture and retained predecessor evidence for unchanged behavior. Keep production code and prior reports intact; leave Windows observations to wg-03.
- Added a StrictMode dialog fixture that imports useDialogBackdropDismiss directly. The fixture owns callback replacement and records dismissal identities; the production hook owns gesture admission. The test holds a real Chromium outside press across the rerender, observes the replacement callback effect is ready and no callback has run, then releases and asserts exactly one replacement call and dialog closure.
- Addressed finding stale-dismiss-callback-coverage from review f37c93f0eec26aa425df6ec866effa607e5618cf6927a6714878df6e5be7682c. Production files and existing focused cases remain unchanged. Specification decision: no specification impact; runner_terminals.md and its index still describe the same owners and behavior. The new focused test adds missing observable coverage without replacing the existing representative test routes.

## Validation
- npm run test:e2e -- tests/e2e/dialog-backdrop-callback.spec.mjs: one Chromium case passed (4ad2e784-b3bd-48de-81d9-3345981f4b31). Recorded callback transition original to replacement, calls [replacement], and closed dialog. Existing managed page-health checks passed; owned server teardown recorded closed=true.
- Initial attempt b13ae25b-ebe0-4331-a310-0108fdb181c2 failed during diagnostic collection: the role locator excluded the already closed dialog. The callback assertions had passed. Replaced that locator with a stable dialog selector and reran the exact case. Preserved the failed report, outcome and pre-repair test bytes.
- Reuse the generation-1 immutable focused results for unchanged image consumers, Settings/Help, interrupted pointers, setup, shortcuts, removal and non-image previews, with their original failure and fixture provenance. The old theme-change test proves press continuity only; current-callback identity is now established by the new fixture. No production or dependency changes require another build or broader suite.
- New files verified UTF-8 without BOM and LF. Report identity and historical reports preserved. Exact changed-path and whitespace checks recorded in invocation diagnostics.

## Review
- Correction is ready for independent Revision Review; Runner retains staging, commit, acceptance and publication. No user action is required for this browser test correction.
- Fresh isolated Windows renderer observations remain assigned to wg-03. This fixture supplies browser hook evidence, not native Windows input or whole-R04 completion.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-109","work_group_id":"wg-02","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
