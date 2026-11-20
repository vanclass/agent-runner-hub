# IssueRun Candidate Report

## Task Info
- Task Number: 245
- Task Title: Windows Explorer Attachment and Authenticated Preflight Verification
- Task Title (KR): Windows 탐색기 첨부 및 인증 사전 점검 검증
- Summary: Both Explorer transfers are unverified because the current input owner cannot perform the cross-window gesture. Retained the separately scoped historical authenticated Runner preflight and the applicable routing and viewport evidence.
- Summary (KR): 현재 입력 도구로 창 사이의 끌어 놓기를 수행할 수 없어 두 탐색기 전송은 미검증 상태입니다. 이전 Runner 인증 사전 점검 결과와 라우팅 및 터미널 화면 안정성 검증 근거를 각각의 범위에 맞게 기록했습니다.

## Work
### Plan

Confirm the exact Candidate and assess the two Explorer input gates separately. If a gate is met, capture the native event, thumbnail and staging inventories before and after that destination's gesture. Reconcile the ordinary authenticated preflight and regression evidence independently.

### Result

Confirmed AgentRunnerHub Candidate generation 1 at `92e3d12565a4795db59edd45f293be8ba63c45c7`. The only Candidate change is this report. Windows reported an Explorer process, but live Computer Use discovery returned no eligible target for the queried Explorer window. The current provider binds both drag endpoints to one acquired client. The debug fixture provides native renderer observation but no OLE source. The prerequisites for either physical attempt were unavailable. No Hub fixture was launched and no native input was issued. Computer Use release confirmed native input, presentation, desktop lease and worker settlement.

## Validation
- **Runner Explorer transfer — unverified.** Missing the native Tauri drop event from a genuine Explorer drag into non-composer Hub content with Runner active, the original-path thumbnail before submission, exactly one Runner staged attachment and unchanged inactive inventories.
- **Single Entry Explorer transfer — unverified.** Missing the separate native event and original-path thumbnail with Single Entry active, exactly one Single Entry staged attachment and unchanged inactive Runner and other destination inventories.
- **Ordinary authenticated preflight — historical pass.** The retained ir-109 Worker result (`27dfa0ca8c2742ddb7b028a99ee64d4d`, `authenticated-preflight`) records programmatic selection of the original `original.png`, correlated authenticated registration, stable reference inventory and successful ordinary configured Runner Work on `2ecf55b8fe7bedbd187e67468dfc299b97cb9cc5`. The two recorded Hub source inputs match this Candidate. The later Observe diagnostic records rejected responses, and the accepted branch still reads the reference capabilities. Current-build authenticated execution and Explorer-to-preflight correlation remain unverified.
- **Regression evidence — retained.** The exact Hub routing, deduplication and focused test inputs still match the admitted source comparisons. Report 223.2 records 16 Chromium passes, including destination routing, deduplication, fixed terminal viewport and localized feedback. That suite was retained at its scripted scope. No new suite ran during this verification.

## Review
- R01 remains blocked. On resumption, use a supported image at a recorded original path and an isolated, revision-bound Hub with its native-event observer ready. With Runner active, have an authorized operator drag the image from File Explorer into non-composer Hub content and compare the Runner and inactive inventories. Repeat as a separate gesture with Single Entry active and verify that inactive Runners remain untouched. Capture each native event and the original-path thumbnail before submission.
- Readiness and input settlement evidence is retained in the Worker diagnostic. Independent Review of this attempt is pending.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-114","work_group_id":"wg-01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
