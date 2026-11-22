# IssueRun Candidate Report

## Task Info
- Task Number: 255
- Task Title: Verify Runner sidebar transitions and icons
- Task Title (KR): Runner 사이드바 상태 전환과 아이콘 검증
- Summary: Verified the five-mode sidebar matrix and the installed Hub's switch from blue play to yellow exclamation on one authenticated Runner. Native reply admission remains blocked by the Runner release check.
- Summary (KR): 5개 모드의 사이드바 상태 전환과 동일한 인증 Runner에서 파란색 재생 아이콘이 노란색 느낌표로 바뀌는 것을 확인했다. 설치 환경의 답변 제출은 Runner 해제 확인 단계에서 차단되었다.

## Work
### Plan

- Extend the five-mode renderer audit through release, disconnection, failure and return. Exercise a committed IssueRun wait while work is independently active, then retire the wait.
- Extend the native harness with an explicit disposable IssueRun case that submits through the composer and correlates authenticated activity with the same sidebar row. Record the first unavailable prerequisite and preserve observations from stages that ran.

### Changes

- Extended the five-mode renderer matrix through disconnection and recovery on a fresh PTY, nonzero process exit and return on another fresh PTY. The fixture resolves the PTY bound to the selected row because the Hub can skip a spare when its mode differs.
- Added a paired IssueRun fixture with committed user input and independently active work. It checks the yellow exclamation and accessible name, retirement of the committed wait under indeterminate execution, and the return to Running with verified Interpreter evidence.
- Added the opt-in `issue-sidebar-lifecycle` native probe under the existing WebDriver harness. It drives the normal Composer in a new owned session, compares authenticated producer state around each marker sample, and retains the exact row, session, generation, committed revision, Interpreter identity, marker shape, color and accessible name when observed.

## Validation

The Chromium suite passed 11 focused cases. Each transition below checks the marker and its accessible name. The five-mode test also checks the rendered SVG.

| Mode | Observed renderer transitions |
| --- | --- |
| Pure Direct | Starting arc → Verified idle circle → Running play → Attention exclamation → Running → stale Unknown → Verified idle → disconnected Unknown. Fresh PTY returned through Starting, Verified idle, Running and release. Nonzero exit showed Failed and another fresh PTY showed Verified idle. |
| Direct | The same startup, work, attention, stale, disconnect, failure and fresh-PTY return sequence passed. |
| Task | The same sequence passed. A separate case observed started Work → succeeded → Verified idle with the unread-completion indicator. |
| Issue | The same sequence passed. The paired producer fixture checked blue play with Running, yellow exclamation with the response-or-approval label, wait retirement to Unknown, and subsequent live Interpreter evidence restoring Running. A nonzero process exit replaced a previous IssueRun wait with the red Failed marker. |
| Subagent | The same startup, work, attention, stale, disconnect, failure and fresh-PTY return sequence passed. |

- The revision and Work safety cases preserved Unknown for crossed or unsupported evidence and verified command and submission guards under incomplete observations.
- The Windows Rust observation filter passed 21 tests. One installed recovery test was ignored by its existing prerequisite. The native harness passed 25 lifecycle, correlation and CLI checks.
- The first native attempt stayed in Task mode with no Work submission receipt. After explicit startup account selection, a new attempt entered IssueRun mode and returned an accepted Work receipt. Its authenticated observation still had an empty IssueRun identity and the composer retained the draft with unknown delivery. A third owned session selected the registered AgentRunnerHub Target through the Hub before submitting.
- The first Project-bound probe observed blue play and the computed accessible name “Running” in IssueRun ir-132 revision 5. The producer named the live Thread and Turn before Work start. The observation window ended with the Discussion wait still unverified.
- A fresh native probe using a normal Discussion prompt observed both markers on session 1, generation 2, in IssueRun ir-133. At revision 5, before Work start, the original row showed blue play and “Running.” At revision 7, the committed Discussion wait showed the yellow exclamation and “IssueRun needs your response or approval.”
- Enter on the follow-up kept the draft and returned `runtime.entry.unsent` with reason `runtime.entry.releaseUnconfirmed`. The producer stayed at revision 7 with the same committed Discussion wait. Work request 15 was the only observed submission. The native test therefore verified the initial marker switch and localized name while reply admission and renewed interpretation remained unverified.
- The final native case reproduced both markers on IssueRun ir-136, then closed only its owned PTY after verifying the reply was unsent. Windows reported exit code 1, and the original row changed from yellow exclamation to the red failure mark with the computed name “Failed.” The five-mode Chromium matrix separately verified Unknown on disconnection without known failure and return on a fresh PTY.

## Review
- Review finding `supported-mode-transition-audit` has current renderer coverage for all five modes, including return on a fresh PTY after disconnection and process failure, plus committed wait concurrent with work and wait retirement. The native observations also establish the real same-Runner switch from live interpretation to a committed Discussion wait.
- Review finding `native-issue-transition-coverage` remains open for reply admission, renewed work and settlement. The normal composer requires Runner release, and the installed Runner's Work submission gate rejects a session with a bound IssueRun. Further end-to-end verification requires an authorized same-session reply path. The report and immutable diagnostics are ready for independent Review.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-128","work_group_id":"wg-hub-sidebar-lifecycle","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
