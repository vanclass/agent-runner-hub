# IssueRun Candidate Report

## Task Info
- Task Number: 250
- Task Title: Keep instruction history with the Runner selected by keyboard
- Task Title (KR): 두 지시문 편집기의 실행 취소와 다시 실행
- Summary: Verified that undo and redo follow the Runner tab selected by its new keyboard position after a mode change.
- Summary (KR): 모드 변경 후 새 키보드 순번으로 선택한 Runner 탭에서 해당 초안만 실행 취소 및 다시 실행되는지 확인했습니다.

## Work
- Plan. Preserve the existing idle-session history reset and recheck it. Extend the grouped navigation fixture to change the order of two Runner tabs with distinct drafts, then select the moved tab from Single Entry by its new keyboard ordinal. Verify the selected tab ID, draft isolation, and delivery counts.
- Extended the existing Runner mode-move case with three distinct two-edit drafts. Changing Issue Run to Direct Run moved the existing Runner from second to first. The case selects that UUID from Single Entry with Ctrl+1 and checks both history directions, the two peer draft values, and work submission, command request, and terminal write counts.
- Revalidated the existing history reset when a released idle session is promoted with a new tab ID. The change adds regression coverage to the candidate's existing production behavior.
- Updated the Hub keyboard section in `docs/implementation_specs/runner_terminals.md` to describe tab ownership across grouped navigation and point to the focused test. The existing specification index already routes to this section.

## Validation
- `npm run build` passed TypeScript and Vite. Vite reported its bundle-size advisory.
- Three focused Chromium tests passed. They cover grouped keyboard selection after a mode move, same-session reuse under a new tab UUID, and focused mixed Korean and ASCII multiline editing, IME, Shift+Enter, Enter delivery, history cleanup and draft isolation. The initial grouped test tried to type while Single Entry was read-only during initialization. It passed after the fixture waited for the textarea to become editable.
- A fresh isolated Windows WebView2 probe passed mixed Korean and ASCII multiline undo, redo, redo invalidation and draft switching in both composers. It observed no work submission and released its process and listener. Grouped ordinal selection and idle reuse were exercised in Chromium.
- `git diff --check` passed. The structured result references the finalized Chromium and WebView2 observations.

## Review
- REQ-05 is ready for independent Revision Review. The focused runs cover the two retained idle-reuse findings and the grouped-navigation coverage finding. The Worker completed automated verification for this Work Group.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-119","work_group_id":"wg-edit-history","generation":3}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
