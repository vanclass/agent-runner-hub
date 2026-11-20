# IssueRun Candidate Report

## Task Info
- Task Number: 250
- Task Title: Isolate instruction history when Runner tabs are reused
- Task Title (KR): 두 지시문 편집기의 실행 취소와 다시 실행
- Summary: Give each newly promoted Runner tab a fresh instruction history.
- Summary (KR): 새로 생성되는 Runner 탭마다 독립적인 지시문 편집 이력을 제공한다.

## Work

### Plan

Reset the existing draft history at Runner tab promotion. Reproduce the leak through the real composer with the idle reuse fixture, verify the new tab uses the same session under a different ID, and check both edit shortcuts against the empty draft and request counts. Update the keyboard specification and rerun the focused composer checks.

### Implementation

- `RunnerSession.promote` resets the existing `InstructionHistory` before assigning the new tab ID. The history owner clears both stacks and pending composition together. Ordinary tab selection retains each draft's history, and the reused session keeps its native process.
- Extended `tests/e2e/instruction-history.mjs` with old-tab undo and redo entries, an empty draft at removal, and same-session promotion under a different tab ID. The new tab stays empty through Ctrl+Y, Ctrl+Z, and a second Ctrl+Y. Work submissions, command requests, and terminal writes stay at their pre-shortcut counts.
- Updated the existing keyboard specification in `docs/implementation_specs/runner_terminals.md` via the Project implementation specification index. The frozen AgentRunnerHub Project policy environment had no Project Policy Index.

## Validation

- Before the fix, the focused Playwright case reached same-session promotion and recovered `Removed draft` in the new tab. After the fix, all six selected Chromium cases passed. They covered idle reuse, both composers, multiline Korean and ASCII edits, IME, redo branching, draft switching, explicit delivery, and navigation and focus guards.
- A freshly built Windows WebView2 probe passed in an isolated background profile. Both focused textareas restored their mixed Korean and ASCII multiline edits, discarded redo after a new edit, and retained separate drafts across view switches. The probe observed no work submission. The released-session promotion case used the Chromium transport fixture.
- `npm run build` and `git diff --check` passed. Verified UTF-8 and LF preservation and the report's original identity footer.

## Review

To verify manually, type and delete text in an idle Runner tab, then remove it. Create a new Runner and focus its composer. When the idle session is reused, Ctrl+Z and Ctrl+Y should leave the new draft empty. The Candidate is ready for independent Revision Review.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-119","work_group_id":"wg-edit-history","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
