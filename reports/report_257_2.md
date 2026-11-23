# IssueRun Candidate Report

## Task Info
- Task Number: 257
- Task Title: Correlate Single Entry cleanup with live Runner execution
- Task Title (KR): 실시간 시작 증거와 단일 입력 정리
- Summary: Single Entry keeps the original Brief and selected images until fresh evidence confirms that the assigned Runner is executing the matching IssueRun.
- Summary (KR): 할당된 러너가 해당 이슈 실행을 실제로 시작했다는 최신 증거가 확인될 때까지 단일 입력의 원래 브리프와 선택한 이미지를 유지합니다.

## Work
- Plan. Require fresh native execution evidence for the original Brief/Run attempt, exercise a grant that arrives first, and validate the ordinary and delayed paths with their receiving references.
- RunnerBrief correlates the original Run request and generation with authenticated Interpreter activity for the same IssueRun at or after the receipt revision. Single Entry retains its assignment and image lease until that check passes, then uses its existing once-only cleanup.
- Updated the existing Brief/Run section of `docs/implementation_specs/runner_terminals.md` and the affected composer fixtures. The AgentRunnerHub specification index identifies that section. The frozen AgentRunnerHub policy index was absent.

## Validation
- The isolated generation-1 baseline cleared the draft after the grant alone. The corrected Chromium fixture retained the draft and selected card through that grant and activity from another IssueRun, then cleared them on matching native activity. The fixture observed one Run invocation and preserved the receiving reference.
- The exact Windows native build cleared ordinary Work request 22 during the first live Discussion in `ir-140`, with the retrospective Work marker still zero. It also cleared the original delayed Brief/Run request 23 during a matched live Interpreter turn in `ir-141`. Both used session 0, generation 1. Each receiving owner retained one immutable delivery with the exact submitted body and image reference. Both fixture processes released their resources.
- TypeScript/Vite and the ordinary native library build passed. The two focused Chromium batches passed 25 checks, including pending and committed Briefs, stale and crossed results, replay protection, confirmed-unsent image and peer recovery, and draft/history isolation. The earlier broad batch timed out after exposing stale assertions about Hub logs and the TaskRun target prefix. Both browser attempts that hit an invalid React hook during fixture startup are retained alongside the passing focused evidence.

## Review
- The two retained findings, `brief-clears-before-native-execution` and `brief-authorization-before-start-uncovered`, are addressed by the live-execution check and the grant-first regression. The native evidence verifies origin cleanup and receiving references for both submission paths. The Candidate is ready for independent Revision Review.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-128","work_group_id":"wg-single-entry-start-live-evidence","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
