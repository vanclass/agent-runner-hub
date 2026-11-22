# IssueRun Candidate Report

## Task Info
- Task Number: 254
- Task Title: Single Entry start confirmation and draft cleanup
- Task Title (KR): Single Entry 시작 확인과 초안 정리
- Summary: Keep the original Single Entry Brief/Run attempt available for authenticated start checks after the initial wait. Clear its draft and delivered image cards when the matching start is confirmed.
- Summary (KR): 첫 확인 시간이 지난 뒤에도 원래 Single Entry 브리프/실행 요청의 시작을 확인합니다. 해당 요청의 시작이 확인되면 제출한 초안과 이미지 카드만 정리합니다.

## Work
- The plan was to retain the original Brief/Run attempt in Single Entry and reuse authenticated Run status in the session control owner. On matching initiation, settle the originating draft and verified attachment lease. Exercise delayed and ordinary starts, retention behavior, and draft history.
- `RunnerBrief` shares the same initiation parser and request correlation between the initial wait and subsequent status reads. Its late observer uses the original invocation ID and authenticated session generation. The existing control refresh drives at most one status read at a time.
- Single Entry retains the original draft revision, selection, and lease. On matching start it releases the original reservation, clears the matching draft and its history, and removes only the cards delivered through that lease. The reference selection owner retains unrelated cards and leaves the Runner's reference IDs in its own custody. Confirmed unsent input follows the existing recovery path.
- The revision guard also protects edits that return to the same visible text. The composer retains its existing editing and undo handlers.
- Updated the Single Entry assignment and Brief/Run descriptions in `docs/implementation_specs/runner_terminals.md`. The existing routes in `docs/implementation_specs/IMPLEMENTATION_SPEC_INDEX.md` already point to these sections and their source and test owners.

## Validation
- TypeScript and Vite build passed. The Windows desktop test build and authenticated read-only probe passed.
- 21 focused Chromium checks passed. They cover ordinary IssueRun Work with an image, immediate and delayed Brief/Run, exact submitted bodies and reference IDs, crossed and wrong-generation observations, confirmed-unsent and uncertain delivery, and draft and attachment isolation. The late-start browser case advances past the initial wait and confirms that a later matching reply clears the origin while the fixture Runner is active.
- The wider Chromium run reached 24 passes, 14 failures, and 40 unexecuted cases before its global timeout. The 13 existing failing cases reproduced on the frozen base. The new late-start case passed after observing the composer attempt directly because the synthetic harness lacks Hub log storage.
- Native Work with the AgentRunnerHub target selected reached authenticated admission for request 22 in session 0, generation 1. The Runner reported `incomplete` with `started_event_id=0`. The origin retained the original draft and image, so this attempt established retention without establishing cleanup after a real Work start.
- Native Brief/Run staged once and invoked Run once. A controlled delay withheld the status receipt from the Hub past its initial wait. Single Entry retained the draft and card until the authenticated status for invocation 23 confirmed a matching start in session 0, generation 1. The origin then showed a blank draft and zero cards, and the Runner snapshot retained its registration receipt. The IssueRun was nonterminal and discussing. The session separately reported `INTERACTIVE_READY` and `owned_execution_alive=false`, so the probe failed its active-execution assertion.

## Review
- REQ-01 remains blocked on native verification. The outstanding checks are cleanup after a canonical ordinary Work start and cleanup while the structured submission owns an active native execution, with the destination reference set verified. The focused Chromium results and the narrower native observations are retained for independent Runner review.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-128","work_group_id":"wg-single-entry-start","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
