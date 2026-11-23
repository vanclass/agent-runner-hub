# IssueRun Candidate Report

## Task Info
- Task Number: 256
- Task Title: Reopen the Runner composer when typed Run is delivered
- Task Title (KR): 입력된 /run 전달 시 편집창 해제
- Summary: Reopen the owning Runner-tab composer on authenticated typed Run delivery and preserve the next draft through owner settlement.
- Summary (KR): 입력한 `/run`의 수락 영수증을 받으면 해당 Runner 탭의 편집창을 다시 열고, 실행 결과가 돌아와도 새 초안을 보존합니다.

## Work
- Route canonical IssueRun `/run` from the Runner-tab Enter handler to the existing authenticated Run operation. Bind the receipt to the originating tab, connection generation, request and draft revision. Keep Brief staging and other commands on their existing paths.
- Verify delivery while the owner is held, failure and no-replay behavior, replacement typing, and the shared editor and Brief regressions. Update the terminal specification within its existing sections.
- Implemented canonical typed `/run` via the existing authenticated `run.invoke` operation. The delivery owner matches the native session, generation and request. The Runner tab clears its submitted revision and history once, then permits local editing while Runner continues.
- Definitive nondelivery keeps the draft. Unknown delivery keeps its replay guard. Runner applies its live command gate when the user submits another command. Ctrl+Enter still stages the complete draft as Brief and clears at verified Run initiation.
- Updated the terminal specification and its index. Checked the exact AgentRunnerHub Project policy index location and found no project-specific index.

## Validation
- The current Windows Tauri/WebView2 build passed both background native cases with the current Runner control and canonical owners in disposable installations. The fixture scripted IssueRun role responses and dispatched DOM keyboard events inside the owned WebView.
- Typed Enter reached the owner once with its exact Korean and ASCII arguments. In session 1, generation 2, request 3 returned `request_accepted` while the owner was held. The editor was empty, focused and editable. Runner denied request 6 with `RUN_DISPATCH_ACTIVE`. The replacement draft survived denial and the original owner's return after the fixture-induced role failure.
- Ctrl+Enter staged the exact Korean multiline Brief in request 8 on the same native build. Argument-free Run request 9 followed staging. Status request 17 verified initiation for request 9, and the composer cleared. Both native cases released their listener and isolated profile.
- Managed Chromium passed 20 focused cases covering receipt mismatches, proven nondelivery, uncertainty without replay, late settlement, other slash routing, Brief, IME, undo and redo, and independent drafts. TypeScript/Vite build, the ordinary native library check, line-ending and encoding checks, and `git diff --check` passed. The localization suite reported the same two unused Hub Log keys on the Candidate and baseline.

## Review
- REQ-04 has current Candidate evidence for independent Review. In an IssueRun Runner tab, Enter on `/run` should clear the submitted draft at authenticated delivery. Type a replacement while Runner continues and verify it remains when the owner returns. Ctrl+Enter in a fresh IssueRun tab should stage the exact Brief and clear its draft when Runner confirms initiation.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-128","work_group_id":"wg-typed-run-delivery","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
