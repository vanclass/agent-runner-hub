# IssueRun Candidate Report

## Task Info
- Task Number: 256
- Task Title: Preserve typed Run delivery and composer behavior
- Task Title (KR): 입력된 /run 전달 시 편집창 해제
- Summary: Restored the typed Run byte limit and compact composer behavior. Verified authenticated delivery, draft and attachment isolation, and separate Brief initiation.
- Summary (KR): 입력된 /run의 바이트 제한과 편집창 축소 동작을 복구했습니다. 인증된 전달, 초안과 첨부의 분리, 별도의 Brief 시작을 검증했습니다.

## Work
- The pre-implementation plan was to check the full typed slash draft at the Hub command boundary, reuse the per-tab compaction flag, and exercise the byte limit, retained drafts, and independent selections. The plan also called for rerunning the authenticated Runner fixture on the final Candidate.
- `RunnerTypedRun.ts` enforces the native slash limit of 4096 UTF-8 bytes before allocating a typed Run request. Oversized input keeps its draft and reports an unsent outcome in the localized Hub Log. Ctrl+Enter uses the independent Brief path.
- `RunnerSessions.ts` reuses the existing compact flag when typed Run is submitted. Wrapped drafts fit three rows while delivery is pending and after a retained outcome. The existing draft edit path restores growth. The originating tab continues to own draft revision and history, and `RunnerTypedRun.ts` owns receipt settlement.
- The fixture now observes attachment and draft ownership in a second Runner tab and Single Entry before and after delivery. It confirms zero reference mutations, no cross-tab Run invocation, and no PTY fallback. The existing `runner_terminals.md` specification records the typed command limit and compaction boundary. Its index already routes to the affected source and checks. The frozen AgentRunnerHub policy index was absent.

## Validation
- The exact Windows Tauri Candidate built successfully and passed both isolated native cases. Typed Enter reached the canonical owner once. The authenticated receipt reopened the empty, focused editor while the owner was held. A second invocation received `RUN_DISPATCH_ACTIVE`. Replacement text survived both denial and the original owner's return with the fixture's injected app-server failure.
- Ctrl+Enter staged the exact bilingual multiline Brief and reached verified initiation through the separately correlated Run request. Both native fixture processes settled and released their runtime resources. Windows denied deletion of a read-only Git pack in the disposable fixture data, and automatic command review blocked forced cleanup. The remaining data is confined to the Candidate's ignored temporary directory.
- The focused Chromium batch passed all 29 cases. It covered 4096-byte and 4097-byte ASCII and Korean drafts, the localized unsent message, pending and retained compaction, confirmed-unsent and uncertain outcomes, stale receipts, independent attachments and drafts, other slash commands, IME and undo/redo. A Brief body exceeding the typed slash limit staged successfully.
- A broader regression run passed 67 cases and timed out on one legacy Brief log assertion. An earlier broader run also reached the overall timeout and failed legacy slash log assertions. The focused Brief tests and authenticated native probe verified staging and initiation directly. The catalog audit reported the same two unused Hub Log keys at Candidate entry and after the change. The new EN and KR key passed parity and interpolation checks.

## Review
- The three retained findings from Review `b4d018734e5dec4c2110cae30b87913dab1bcb42114f9cf1003495c297e4b626` have current evidence for the typed limit, compaction, and independent selections. The Worker handoff includes the Candidate source bindings and diagnostic artifacts.
- User verification is covered by the focused browser and Windows native probes for this Work Group. The Candidate is ready for independent Revision Review.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-128","work_group_id":"wg-typed-run-delivery","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
