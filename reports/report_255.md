# IssueRun Candidate Report

## Task Info
- Task Number: 255
- Task Title: Runner sidebar status transitions and icon validation
- Task Title (KR): Runner 사이드바 상태 전환과 아이콘 검증
- Summary: The Hub sidebar now reads authenticated IssueRun Interpreter activity and committed user waits. The Candidate includes focused parser and renderer checks for the status transitions.
- Summary (KR): Hub 사이드바가 인증된 IssueRun 해석기 활동과 확정된 사용자 응답 대기 상태를 표시하도록 수정했습니다. 상태 전환을 확인하는 파서와 화면 테스트를 보강했습니다.

## Work
- Plan before implementation. Compare the accepted Runner activity contract with the Hub decoder and existing marker projection. Add the compatible observations at that boundary, preserve command and reuse ownership, and verify the visible and accessible transitions using focused browser and isolated native checks.
- Compared the accepted Workspace producer at `d1aaa67e689d7e5f2fa3139420595b5ca8d4e1e7` with the Hub baseline at `8208d228e86463e77aa2feea9078e1d182e3595f`. The verified Project specification index routes the sidebar contract to `runner_terminals.md`. The bound Workspace context has no AgentRunnerHub Project-policy index.
- The Rust decoder preserves explicit missing or malformed authority and passes the producer's typed Interpreter identity to the existing sidebar projection. The producer owns the committed IssueRun revision and native execution identity. The Hub derives each marker directly from the current authenticated observation.
- The sidebar shows Running for verified Interpreter activity and gives a committed Discussion, reply or approval wait priority. A successor reservation with only admission or a prior Turn's start stays Unknown. The existing marker shapes and localization serve the new projection. Configuration, input, commands, recovery and reuse continue through their existing owners.

## Validation
- The final staged Windows Tauri build succeeded and both focused Rust protocol tests passed. They exercised current and crossed authenticated responses, a partial Interpreter identity, and explicit null versus absent fields.
- Nine focused Chromium checks passed on the final Candidate, and a separate 13-check regression selection passed during implementation. The regression selection exercised simulated exit failure and normal exit, Task completion and unread state, marker placement across themes, and IssueRun composer behavior. A fixture initially stayed in the default Task mode. Selecting Issue mode consistently in the mock configuration corrected the fixture setup and the focused rerun passed.

| Mode | Browser fixture transition | Observed marker and accessible state |
| --- | --- | --- |
| Pure Direct | Connect → idle → work → attention → work → stale → idle → disconnect | Starting → Verified idle → Running → Suspended / needs attention → Running → Status unknown → Verified idle → Status unknown |
| Direct | Same sequence | Same markers and accessible labels |
| Task | Same sequence, plus completed work and renewed work | Same markers and labels. Verified release returned to idle and retained the unread completion. |
| Issue | Same sequence, plus live Interpreter before a Work record → committed Discussion → response admission → renewal → wait concurrent with work → retirement | Blue play with Running, yellow exclamation with the IssueRun response or approval label, and Status unknown during an unverified reservation. Crossed identity/revision, malformed identity and unsupported execution produced Unknown. A nonzero process exit overrode the prior wait. |
| Subagent | Same common sequence | Same markers and accessible labels |

- The final native background WebView2 probe read the accepted producer's matching unbound idle and no-user-action signals over authenticated Local Control in Task mode. The same owned Runner row exposed a visible-size green icon in the renderer DOM with the accessible name “Verified idle.” The nonactivating display probe decoded the same contract but failed its foreground-window ordering check. Both probe owners settled and released their resources.
- The standard native Runner inspection connected but did not return a correlated authoritative session-configuration receipt. Authentic IssueRun work, committed input wait, admitted reply, renewal and settlement remain unverified in the installed composition.
- The retained Worker diagnostics include the Chromium results, Rust protocol output and both native renderer evidence files. The changed text is UTF-8 without BOM with LF endings, and existing Korean text was preserved.

## Review
- REQ-03B remains blocked on genuine native lifecycle evidence. The Candidate contains the implemented projection, focused fixtures and updated specification for independent review.
- To verify the remaining outcome, bind the exact Candidate and accepted Runner in an isolated native session with a correlated configuration receipt. Observe the same Runner's visible and accessible marker through live Interpreter work, a committed reply or approval wait, input admission, renewal, settlement and disconnection.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-128","work_group_id":"wg-hub-sidebar-lifecycle","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
