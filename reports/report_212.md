# Session Report

## 1. Task Info
- Task Number: 212
- Task Title: Correct IssueRun sidebar attention projection
- Task Title (KR): IssueRun 사이드바 주의 상태 표시 수정
- Summary: WG7 only: distinguish verified autonomous activity from user handoff; preserve WG5/WG6 and execution authority.
- Summary (KR): WG7 범위에서 자동 실행과 사용자 조치 상태를 구분하고 기존 실행 권한을 보존합니다.

## 2. Work Plan
- Trace authenticated Work and control producers, correlate the supplied screenshot and inspect supported native observation availability. Change only presentation where evidence is sufficient; report any Runner-owned user-handoff contract gap. Add focused status and safety regressions, run affected browser tests and production build, and distinguish simulated from native evidence.

## 3. Work Summary
- Partial WG7 implementation: `runnerWork.ts:issueSidebarActivity` supplies an IssueRun-only sidebar projection, consumed by `RunnerSessions.ts:tabView`. Authenticated admitted preparation/active Work displays Running despite foreground ownership. Explicit restart/termination/account setup requirements display Attention; ambiguous incomplete/suspension/recovery evidence stays Unknown. Whole-work success requires fresh released execution authority for Idle. Process failures and stale control observations keep their existing precedence.
- Generic Work activity, admission blocking, recovery, submission, terminal input restrictions, execution ownership and WG6 composer source are unchanged. Updated the existing terminal specification's status contract; no new specification was created. Exact Workspace Project-policy index for AgentRunnerHub was absent.
- Screenshot evidence: yellow Runner 4 marker appears alongside Interpreter preparation for ir-103. Retained ir-103 transitions correlate Interpreter reservation/preparation at 03:34:28/31Z, completion at 03:38:54Z, automatic handoff validation, and Planner reservation/preparation at 03:39:06/12Z on 2026-11-19. This historical evidence does not retain the exact contemporaneous authenticated Hub control/Work snapshot.
- Contract gap: Runner `session/local_control/work.py:issue_state` maps both `front_end.next_action` and discussing/approval statuses to incomplete, and stage controls to suspended. `session/local_control/observation.py:project_observation` exposes generic foreground and recovery fields, not an exact IssueRun human boundary. `lifecycle.py` derives owned execution from task/subagent action ownership, not a complete IssueRun phase indicator. Generic foreground ownership is not proof of user input. Foreground also pauses Work discovery in Hub; that safety guard is preserved.
- Required Runner-owned follow-up: expose an authenticated current IssueRun-bound user-action requirement (question/decision/confirmation/required action), with revision/identity and an authoritative cleared/automatic-work transition, from IssueRun front-end/action authority and execution-feedback human-request owners through local-control observation. No new field, reply mechanism, user response, PTY input or cross-project source change was invented here.

## 4. Validation Evidence
- PASS: `npm run build` (TypeScript and Vite production build); existing large-chunk advisory only. `git diff --check` passed. Modified text retains LF and no BOM; source changes are localized.
- PASS: focused status batch, 7 tests: IssueRun projection and Work blocking invariants, preparation/execution/automatic Planner cases, ambiguous incomplete/suspension/recovery, explicit confirmation and continuation, plus WG5 historical Unknown/fresh Running/verified Idle/unread completion, SVG/color/accessible labels, fixed geometry in light/black themes, process failure and normal/unobserved exit. Artifacts: `test-results/web-app/1b1afc9c-6b67-4b94-9d82-78ebd47cee9f/`.
- Earlier fixture iterations failed before convergence: configuration overwrote the injected run mode, then foreground correctly prevented discovery; the fixture now admits/discovers Work before injecting foreground ownership. These are simulated browser cases, not actual native processing or a real user-turn transition.
- Final strengthened IssueRun case PASS (1 test), `test-results/web-app/2cbb38a4-ce21-4ee8-b1ac-bf80a143bbe5/`: Running with foreground ownership still disables the composer, keeps terminal readonly, emits no PTY writes/submissions, and becomes Unknown with stale control evidence. An attempted duplicate process-exit assertion observed replacement PTY pty-3 rather than the exited identity and was removed as invalid fixture evidence; existing passing WG5 process-error cases retain that claim. The seven-test batch remains applicable to unchanged production source and the other unchanged tests.
- Additional safety batch FAILED (6 cases), artifacts `test-results/web-app/9b6459cb-3adb-431e-ba7d-a735e496f146/`: three old region-count checks expect 3 but observe 4; a legacy foreground-reply case attempts to fill the deliberately disabled composer and expects PTY reply delivery. Other failures retain their original artifacts; no production behavior or assertions were weakened to make this batch green. The new focused checks separately verify unchanged Work blocking and absence of writes/submissions.
- UNVERIFIED: actual Windows Hub Interpreter-to-user-turn transition and exact symptom closure. Existing native harness has no IssueRun human-turn case, and the authenticated contract lacks the distinguishing signal; no existing user session was adopted or controlled. Historical ir-103 correlation is not live supported-path acceptance. Yellow question/decision handoff and its actual automatic continuation remain dependent on Runner's contract extension.

## 5. User Verification Message
- The bounded projection change is implemented, but WG7 is not claimed fully repaired. Confirmed autonomous Work can show blue Running while ambiguous handoff evidence stays Unknown. Exact conversational Attention and supported-path symptom closure require the Runner-owned authoritative user-action signal described above. No user action is requested to bypass this boundary.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"212","task_workload_id":"b3b831c17fb241e49cb3446fd1dd4747"}
<!-- TASK_END_RUNTIME_METADATA_END -->
