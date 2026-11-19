# IssueRun Candidate Report

## Task Info
- Task Number: 223
- Task Title: Hub file drop routing and stable feedback
- Task Title (KR): Hub 파일 드롭 경로 및 드래그 피드백
- Summary: Migrate native ingress to one Hub feature owner and validate destination routing and stable rendered feedback.
- Summary (KR): Hub 전체 파일 드롭 경로를 단일 기능 소유자로 옮기고 대상별 안내와 로그 화면 안정성을 검증했다.

## Work
- Work Plan: Compare retained source, reuse compatible routing and fixtures, preserve composer eligibility and staging ownership, verify Help transitions, then update the affected specifications and record focused validation.
- Work Summary: Hub composes the eligible active selection; hubFileDrop owns one native subscription, transient hover and disposal. Workspace renders the destination hint and whole working-area outline. Existing selections retain staging writes; composers retain paste, draft and submission. Compatible historical routing/tests were adapted without reverting newer composer sizing. A modal transition observer and Escape cleanup close the historical Help gap.
- Specifications: Updated runner_terminals.md, native_automation.md and the existing index for changed ingress, presentation ownership and the physical acceptance boundary. No new feature document was needed. The exact Target policy index was absent in the frozen Workspace context; no Project policy was inferred.

## Validation
- Validation Evidence: TypeScript/Vite build passed. The final focused routing, fixed-content EN/KR rendering and composer regression cases passed (13 cases); before/during/after geometry, visible text, scroll and exposed log pixels matched for Runner and Single Entry. Screenshots confirm the outline surrounds output/input and the hint leaves logs unobscured. Tests also cover Help open/close, Escape, drop/leave, inactive-owner isolation, disabled App Settings and unrelated HTML drags.
- Localization: Catalog validation failed on unused hubLog.older and hubLog.unsaved keys. Running the same checker on frozen HEAD reproduced exactly those errors; the changed destination keys introduce no new errors. Preserve this unrelated failure without claiming a fully green localization suite.
- Sidebar regression: The navigation suite remains failed. Narrowed old ambiguous settings selectors; retained runs 440c2f3f and 95135a76 exercised reorder, rejected cross-domain reorder, selected tab/draft/native ownership preservation and restored order before failing in later settings assertions. Later reruns failed earlier on synthetic startup domain counts (two TaskRun rows instead of one), before drag. These failures remain in immutable evidence; no sidebar production behavior was changed or whole-suite success claimed.
- Integrity: Localized patches retain LF, UTF-8/no-BOM and existing Korean CSS comments. The added CSS tuning comment explains the changed hint spacing. No staging, commit, publication or IssueRun state mutation was performed.
- Native disposition: Actual Windows file-manager transfer into non-composer Hub content remains unverified separately for Runner and Single Entry. Authenticated preflight remains separately unverified. Scripted bridge evidence does not close R01; physical acceptance remains WG-03-owned.

## Review
- User Verification Message: Scoped implementation and R02/R03 evidence are ready for independent Review. Runner retains Candidate admission, commit and publication. R01 is not claimed complete; this group delivers its routing prerequisite and separate native evidence dispositions.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-104","work_group_id":"wg-01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
