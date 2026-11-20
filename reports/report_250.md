# IssueRun Candidate Report

## Task Info
- Task Number: 250
- Task Title: Undo and redo in both instruction editors
- Task Title (KR): 두 지시문 편집기의 실행 취소와 다시 실행
- Summary: Add separate local edit history for the Single Entry draft and each Runner tab.
- Summary (KR): Single Entry 초안과 각 Runner 탭 초안에 독립적인 편집 이력을 추가한다.

## Work

### Plan

Keep each draft with its existing owner and attach local history to that owner. Share the textarea event handling and keep editing separate from command dispatch. Reset history where a delivered draft is cleared. Verify both editors, navigation and submission boundaries, then update the Runner terminal specification.

### Implementation

- Single Entry and each Runner session own separate undo and redo stacks. Each draft owner still controls its text. A shared textarea forwards ordinary input through the existing draft setter and groups composition into one edit.
- Browser history is tied to a textarea instance. Draft-owned history follows the draft through tab changes and resets when the owner clears a delivered draft. A replacement session starts a fresh history over any retained text.
- The shared key handler applies Ctrl+Z and Ctrl+Y to the focused writable textarea. The delivery callbacks remain separate. The Runner terminal specification records the keyboard and draft lifecycle.
- The frozen AgentRunnerHub project policy environment had no Project Policy Index. The admitted Project implementation specification pointed to the Runner terminal document.

## Validation

- `npm run build` passed TypeScript and Vite. The focused Chromium batch passed all four tests, covering mixed Korean and ASCII multiline text, composition, undo and redo, redo branching, separate drafts, navigation, and post-delivery clearing.
- The focused test observed two explicit Enter submissions across both composers. History keys added zero work submissions, command requests, or terminal writes.
- An isolated Windows Tauri WebView2 checked both real instruction textareas with trusted text insertion and WebDriver key actions. Undo and redo restored the expected multiline Korean and ASCII drafts, a fresh edit discarded redo, and switching composers kept their drafts separate.
- Two older Enter tests reached their delivery assertions and failed on both the Candidate and an isolated copy of the unchanged source revision. Those assertions assume a specific PTY and unprepared TaskRun text. The focused checks observed delivery across the fixture's sessions and checked the submitted draft content.
- Git diff, UTF-8 and LF checks passed.

## Review

For UI verification, focus either instruction textarea, enter two edits with mixed Korean and ASCII text, and use Ctrl+Z and Ctrl+Y to move between them. Switch Runner tabs and return to verify that each draft keeps its own history. The focused checks already cover these cases and clearing a delivered draft. Independent Revision Review remains pending.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-119","work_group_id":"wg-edit-history","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
