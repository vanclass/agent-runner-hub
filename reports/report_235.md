# IssueRun Candidate Report

## Task Info
- Task Number: 235
- Task Title: Dialog backdrop dismissal and focused regression coverage
- Task Title (KR): 이미지 뷰어와 대화상자 배경 클릭 닫기
- Summary: Implement shared dialog-local backdrop dismissal and verify browser behavior; Windows observations remain assigned to wg-03.
- Summary (KR): 대화상자 배경 클릭 닫기를 구현하고 브라우저 동작을 검증한다. Windows 검증은 wg-03에서 수행한다.

## Work
- Pre-implementation plan: Adapt the hash-matched historical gesture against current dialog owners. Keep pointer state in the shared hook, dismissal/focus in each dialog, and viewport gestures unchanged. Enable image, ordinary Settings and Help dismissal while protecting required setup. Adapt focused browser checks and update the existing feature specification. Preserve prior attempts as read-only evidence and leave source uncommitted for Runner.
- Implemented the shared dialog-local hook in FocusedViewer image mode, ordinary App Settings and Help. Existing dismissal, focus, viewport zoom/pan, URL and selection owners remain intact. Required setup suppresses backdrop and Escape until successful verification.
- Reused the exact hash-matched historical hook and dialog assertions as source input, adapted their registrations to current tests, and extended pending/failed setup checks. Corrected the removal test's ambiguous Settings selector without changing its cancel/confirm assertions.
- Updated the existing runner_terminals specification sections; no new feature document or index route was necessary. Historical IssueRun 104 execution and native observations remain reference only.

## Validation
- npm run build: passed; Vite reported its existing large-chunk advisory.
- Focused Chromium attempt 690757c7-4f90-44a0-a32b-4d8ee8fee630: 15 passed, 2 failed. Both failures were the removal fixture's ambiguous selector matching Settings and Help, before confirmation. Preserved the original report/outcome and probe-time test bytes.
- After the selector repair, attempt 895ed277-0096-48c8-a3b2-7586b7b587e6: both English/Korean removal cases passed. Seventeen distinct focused cases now pass across the two attempts; the initial aggregate remains failed.
- Verified both production image openers, backdrop/Escape and connected-opener focus, interior/padding retention, wheel zoom and captured pan released outside; interrupted pointers and caller rerender; ordinary Settings/Help controls; shortcut-capture cancellation; pending/failed setup retention and verified exit; removal cancellation and explicit confirmation against disposable fixture sessions; original text and unavailable preview paths.
- Generated images and native IPC are synthetic browser fixtures. No genuine-generation or current Windows renderer claim is made. Final source diff and LF/BOM checks preserve the existing Korean tuning comment and unaffected source bytes.

## Review
- Source and focused browser handoff is ready for independent Revision Review. Runner owns staging, commit, acceptance and publication.
- wg-03 retains fresh isolated revision-bound Windows renderer observations for both image callers, Settings/Help and safeguards, using the existing foreground fixture with current authorized input and owned teardown. Browser passes and historical native receipts do not establish those effects. No additional user action is needed for this group's completed browser scope.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-109","work_group_id":"wg-02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
