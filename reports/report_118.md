# Session Report

## 1. Task Info
- Task Number: 118
- Task Title: WG4 isolated native recovery acceptance
- Task Title (KR): WG4 격리 네이티브 복구 검증
- Summary: Validate exact retained-work recovery, canonical settlement and durable reference retirement through supported native owners, or record the precise unsupported isolation boundary.
- Summary (KR): 지원되는 네이티브 경로로 보존 작업 복구와 정식 종료 및 참조 제거를 검증하고 격리 전제조건이 없으면 정확한 미검증 경계를 기록한다.

## 2. Work Plan
- Inspect existing Hub acceptance tooling and Runner-owned retained-work preparation/lifecycle facilities; establish fixture ownership before any recovery or termination.
- If supported isolation exists, exercise exact-reference native recovery and observation, canonical completion, durable retirement, repeat restoration and unfinished eligibility with correlated identities.
- Change production code only for a demonstrated in-scope defect; run only focused checks supported by actual prerequisites and preserve earlier evidence.
- Record actual native, simulated and unavailable evidence separately, including the exact preparation blocker if native end-to-end acceptance cannot safely proceed.

## 3. Work Summary
- WG4 native end-to-end acceptance remains UNVERIFIED. No production defect was demonstrated and no production code or reusable test infrastructure was changed. Only this active report was edited.
- Preparation boundary: Hub's native Runner owner verifies a managed Python environment and source registration in the chosen installation, then fixes --repo-root to that installation (src-tauri/src/desktop_terminal/runner.rs:35-108). Existing recovery_scope_fixtures.create_workload/create_issue_run create controlled retained state in disposable test storage, not a Hub-launchable isolated installed Runner with a captured genuine work-start reference. No such pre-provisioned candidate was supplied.
- Existing alternatives were insufficient for this acceptance claim: recovery_acceptance.rs opens an idle installed Runner and supports an explicitly supplied reference for read-only observation, but does not provision a retained item or drive recovery-to-settlement. The genuine GUI Task continuation fixture substitutes validation/completion adapters; the package lifecycle fixture uses a fixture entry and controlled environment, not Hub's verified -I installed launch. Connecting these into a new native retained-work harness or installation bridge would extend the available test infrastructure, so that boundary was not invented here.
- Ran three existing focused Runner lifecycle checks with fixture-owned storage and exact child-process handles. They establish native pipe/authentication and canonical storage observation only; no completion was injected into Hub WorkEvidence. Temporary fixture directories and the empty task-local temp parent were removed.
- No unrelated workload/session was claimed, recovered, resumed, modified or terminated. No live Task reference was used as a substitute. No installed Runner recovery.recover request, native Hub crash/restart, canonical Task completion gate, report-validation or Task-End command was executed.
- Prior reports, passing evidence and the disclosed unrelated global-restart provenance baseline failure in reports/report_117.md remain unchanged. Its browser and installed-Runner results remain historical evidence, not new WG4 end-to-end acceptance.

## 4. Validation Evidence
- PASS: Runner-owned managed Python import probe resolved runner to D:/Codex/codex_workspace/agent_runner/src/runner/__init__.py. Hub candidate HEAD: e688d755478338fc6347fc8098fe67b45db360d0.
- PASS: three exact unittest cases in agent_runner.tests.test_recovery_lifecycle_observation.LifecycleObservationTests: test_native_authenticated_replacement_process_observes_exact_reference; test_task_exact_nonterminal_completion_discard_and_read_only; test_issue_identity_and_ownership_without_claim_or_execution. Final result: 3 tests in 2.592s, OK. Used the Runner-owned python-env/Scripts/python.exe with process-scoped PYTHONPATH pointing to agent_runner/src and the verified workspace; current directory remained the Task worktree. Initial invocation could not import the outer agent_runner.tests namespace; it executed no tests. Correcting only that invocation resolved all three import errors.
- NATIVE FIXTURE EVIDENCE: the first case launches two creation-owned, hidden Windows child processes, authenticates inherited private pipes, rejects an incorrect key, checks the hello PID against the captured Popen PID, and correlates completed responses with the full unchanged reference. Canonical fixture Task storage changes from incomplete to completed between child launches. This is the existing recovery_lifecycle_host script using production transport/RecoveryAPI, not an interactive installed Runner or Tauri Hub. Store.terminalize in this fixture is not evidence that a recovered Task completed its supported lifecycle.
- DOMAIN EVIDENCE: exact Task nonterminal/terminal/discard and read-only observations passed; the unrelated unfinished item stayed nonterminal. Issue exact identity/native ownership and no-claim/no-execution observation passed. These do not prove Hub persistence, automatic recovery eligibility after a native crash, or recovered IssueRun canonical completion.
- UNVERIFIED: fixture-owned installed Runner work-start/reference capture; actual recovery.recover and later recovery.observe through the native Hub bridge; owning persisted Hub tab ID; native Hub/Runner PID and creation/session identities across loss/restoration; native request/generation correlation for that work; authoritative supported completion; durable retirement and no repeat recovery; unfinished exact-reference retention/eligibility without duplicate execution. The prerequisite stopped before these observations, so there is no acceptance reference or tab/process receipt to report.
- UNVERIFIED: terminal viewport and recovery-status presentation in the actual native host. No Hub window was launched or observed because no authorized isolated retained-work candidate was established. Prior Chromium fixtures and scripted Provider/protocol outcomes were not substituted.
- Decision-source freshness (SHA-256; workspace-relative Runner paths resolve under the manifest-selected D:/Codex/codex_workspace):
- src-tauri/src/desktop_terminal/runner.rs:35-108: 60a610e15b38e8b8609b86d6ff89e675464b2f5e3c0a18ed0400a7ee07bdbb2c.
- src-tauri/src/desktop_terminal/recovery_acceptance.rs:7-44: 9d2948e57d5f2d55f8a7b8ced528d1099b843c88d21cfcd120fac0663445c754.
- agent_runner/tests/support/recovery_scope_fixtures.py:26-61: 10b144c112b71007d876053dc2ff41d5ebd3df60f83047126400019cb6245002.
- agent_runner/tests/support/task_recovery_completion_acceptance.py, recover_original_gui validate/complete adapters: fa274a790ed53899b73995d006182a0157959b8b18a1f11674ce2c13bdf1dad1.
- agent_runner/tests/test_package_lifecycle_isolation.py, PackageLifecycleIsolationTests.exercise: ab60eb3ab52bb020a10389db61daf961c7f3e0597e93f10b6a9c7782e80f21de.
- agent_runner/tests/test_recovery_lifecycle_observation.py:34,150,243: c5ea9a9ab029078e537affb7c8bd31b1af4c44db3ce3192dbbc172127581d9a8.
- agent_runner/tests/support/local_control_process.py:13-62: f58c233a1a76a73e17b9cf9b2f074b8c7d4de80d32084e4c9072dde4c98f54e3.
- agent_runner/LOCAL_CONTROL.md:237-275: 94606a33c3e828b9ef4346d71bb7bea39962a59fa7603d7a9b439dfa895defe4.

## 5. User Verification Message
- WG4 native end-to-end DoD is not achieved. Three focused lifecycle/native-pipe checks pass, but an isolated installed-Runner retained TaskRun with a genuine captured reference and supported canonical settlement is still required before native Hub recovery, retirement and second-restoration acceptance can run. The inspected existing fixtures do not supply that combined preparation boundary; adding a harness is outside this task. IssueRun parity and actual native viewport/status remain unverified. No live-work access or manual execution of already automated checks is requested; prior passing evidence and production behavior are preserved.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"118","task_workload_id":"870d7d168c6e4b6f934b02df2dcd4c06"}
<!-- TASK_END_RUNTIME_METADATA_END -->
