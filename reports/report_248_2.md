# IssueRun Candidate Report

## Task Info
- Task Number: 248
- Task Title: Run-mode domains and tab settings synchronization
- Task Title (KR): 실행 모드 도메인 표시 및 탭 설정 동기화
- Summary: Restore Single Entry Run Mode edits and verify the Pure Direct add flow through option loading.
- Summary (KR): Single Entry 실행 모드 편집을 복구하고 옵션 로딩 전후의 Pure Direct Run 탭 추가를 검증한다.

## Work
- Plan: Scope placement eligibility to UUID-bound edits, verify Single Entry clear and retained catalog edits, and hold and release the Pure Direct add inspection to check the selected tab and mode-dependent fields in both states.
- HubSelections owns validation and requested defaults. RunnerSessions supplies the accepted-mode callback only for UUID-bound settings. The callback updates RunnerNavigation before configuration draft invalidation can publish the view. Single Entry records explicit clears during inspection and accepts valid edits from its retained catalog during a source gap.
- The browser case parks the replenishing spare to exercise fresh allocation through the actual Pure Direct plus. It holds the new session's first inspection response and checks both an unset Root and a Root entered through Single Entry. Existing fixture cases cover retired idle reuse and hidden spare promotion.

## Validation
- `npm run build` passed with a bundle size warning.
- 16 focused Chromium navigation cases passed. They verified history-only domain removal, the unified add path, immediate same-UUID moves with the terminal and draft retained, stale and unsupported edit guards, and all three allocation paths. In both held-inspection plus cases, the selected UUID remained unique in Pure Direct and the panel showed Pure Direct Run and the expected Root with no Target field before and after readiness. The fixture recorded no plan, apply or work submission from the add.
- All 17 settings initialization cases passed, including the pending first-inspection Run Mode clear and the catalog-backed edit during a source gap.
- Checked the Runner navigation specification against the implementation, its indexed source and test paths, and its preferences and configuration links. The existing description covers the corrected behavior. The structural check and UTF-8, LF and diff checks passed.
- Chromium exercised the production Hub frontend with synthetic native responses. Installed Runner execution was outside these checks.

## Review
- Worker verification addressed `single-entry-run-mode-clear-regression` and `domain-plus-option-timing-coverage`. The candidate and its evidence are ready for independent Revision Review.
- For a manual check, use by-mode display with an existing Pure Direct Run tab and Issue Run selected in Single Entry. Click the Pure Direct plus and check the new tab's selected mode and Root field. Change the tab's Run Mode and confirm it moves immediately while keeping its draft.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-120","work_group_id":"wg-01","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
