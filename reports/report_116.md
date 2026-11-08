# Session Report

## 1. Task Info
- Task Number: 116
- Task Title: Exact recovery lifecycle eligibility and native evidence
- Task Title (KR): 정확한 복구 수명주기 자격과 네이티브 검증
- Summary: Trace recovered-work lifecycle authority, correct supported eligibility errors, and identify any Runner contract blocking exact retirement.
- Summary (KR): 복구 작업의 수명주기 권한을 추적하고 지원되는 복구 자격 오류를 수정하며 정확한 참조 해제를 막는 Runner 계약을 확인한다.

## 2. Work Plan
- Trace recovery.recover, authenticated work observations, canonical completion/discard and version-1 workspace persistence.
- Keep recovery coordination in RunnerRecovery and serialization in RunnerWorkspace; preserve startup orchestration, layout, shutdown and unrelated controls.
- Correct only evidence-supported reference retirement/retention; stop the exact recovered-work implementation path if Runner cannot establish its identity and terminal state.
- Run focused recovery/persistence/control/presentation checks and a bounded isolated Windows native check where supported. Distinguish simulated evidence from real canonical completion and record unavailable prerequisites.

## 3. Work Summary
- Partial implementation; the requested WG4 DoD is not achieved. Runner-owned lifecycle evidence is missing, so the unsupported exact post-recovery retirement path was stopped without changing Runner or inventing a Hub heuristic.
- RunnerRecovery now binds a captured reference to the exact confirmed WorkAttempt that supplied it. Only that bound observation's known terminal settlement can retire it; suspended, incomplete, unknown, missing, unrelated and replacement-process observations cannot retire or substitute retained/uncertain state. Retirement uses the existing changed -> RunnerSessions.changed -> RunnerWorkspace.save version-1 persistence path and restores live eligibility on save failure.
- Preserved recovery protocol, per-tab replacement/startup, terminal layout, navigation, allocation, settings, interaction authority and normal shutdown. Updated directly affected browser checks and the canonical recovery specification's support boundary. Workspace serialization and native protocol were unchanged.
- Trace: Runner session/local_control/recovery.py RecoveryAPI.handle delegates exact recovery and returns admission/outcome/reference only. work.py WorkEvidence._bind requires an existing process-local dispatch; runner_state, exec_run, session_ready/completed_workload_id and issue_state update only an already-bound entry. Recovery does not register that binding. work.list/work.observe therefore cannot establish the exact recovered reference's later whole-work terminal state. Local observation IDs/event ordering cannot substitute for durable recovery identity.
- Missing Runner contract: an authenticated exact-reference lifecycle observation, or a recovery-result binding to a retained work observation, covering canonical completion, intentional release/discard, recoverable suspension/incompletion, unavailable/unknown evidence and owner revision/identity across replacement sessions. This requires a separate Runner-owned change.
- Project policy lookup: exact AgentRunnerHub PROJECT_POLICY_INDEX.md is absent. Existing project recovery specification was maintained through its registered index; no project policy or alternate lifecycle authority was introduced.

## 4. Validation Evidence
- PASS: npm run build (TypeScript and Vite). Initial TypeScript unreachable-branch errors were corrected by removing the obsolete branch; final build passed. Existing bundle-size advisory remains.
- PASS: 19 focused automatic-recovery/intentional-teardown browser checks, including reference retention after renderer crashes (one and three tabs), repeated unexpected Runner loss, no substitution by unrelated active/completed work, exact captured-work retirement, failed retirement persistence, unavailable readiness, incomplete/unknown outcomes, uncertainty/no replay, final exit snapshots and light/black terminal height. These use simulated native evidence; the synthetic completion case now asserts retention instead of claiming real recovered-work completion.
- Final focused regression run: 22 passed / 2 failed. All recovery cases and suspended/incomplete/unknown retention passed; tab-removal reuse and its persistence-failure case expected no native closures but observed closures. Both failures reproduced with the original coordinator restored byte-for-byte (2/2 failed), establishing independence from this delta. Candidate source was then restored byte-for-byte. No navigation/allocation fix or test suppression was applied. Reports: test-results/web-app/1bc26d0a-d0b7-47cf-a921-76c336234a3e/report/index.html (candidate), test-results/web-app/b6c52a68-1a85-4392-b601-7ba84cd8fed1/report/index.html (baseline comparison).
- PASS: native Cargo desktop-terminal lib recovery filter: 3 protocol tests passed, 1 installed acceptance test ignored by default. They cover exact selectors/outcomes, Direct successor correlation and crossed/uncertain/EOF rejection.
- PASS: focused Windows control_handles integration test exact_handle_allowlist_authenticated_roundtrip_and_eof_uncertainty, explicitly enabled with a verified direct Python interpreter. The existing synthetic private-pipe peer exercised authenticated handle restriction, original request/result and exact Direct recovery successor correlation, and EOF uncertainty. This is transport fixture evidence, not retained Task/Issue lifecycle acceptance.
- PASS: opt-in installed_exact_recovery_reference_is_unverified_without_confirmed_work through the production Windows Harness/open_runner/PTY/authenticated control owners, using the verified managed installation. It observed matching completed recovery.reference -> unverified/no reference, terminal bytes, owned shutdown and a fresh authenticated replacement generation. No instruction, continuation, synthetic terminal completion or historical candidate selection was submitted.
- UNVERIFIED: recovery.recover of a fixture-owned retained TaskRun/IssueRun followed by real canonical completion/discard, retirement and no recovery after another abnormal restart; likewise real recovered suspension across another termination. Native Windows host/toolchain was available, but no supported exact-reference lifecycle observation or verified fixture-owned retained-work selector was available. The installed idle probe cannot establish these stronger claims. Restored tab identity/layout were exercised only through browser fixtures, not a retained-work native WebView recovery.
- Preservation review: existing version-1 schema, native recovery protocol, per-tab orchestration and shutdown owners unchanged. Localized ASCII patches preserved untouched bytes, BOM and LF boundaries; no Korean comment changes. No Runner canonical completion gate, report validation or Task-End command was run.

## 5. User Verification Message
- The safety subset is implemented and focused recovery/native transport checks pass. Full WG4 closure remains blocked: Runner does not expose authoritative lifecycle evidence tied to the exact recovered reference. Completed recovered work can still remain eligible; Hub deliberately preserves it instead of guessing completion. Real completion/no-recovery-on-next-crash, real suspended recovery and retained-work native WebView acceptance remain unverified.
- Required next scope is a separate Runner-owned exact-reference lifecycle contract and validation with a fixture-owned retained TaskRun/IssueRun. This task does not modify Runner, guess history, replay instructions, request user secrets or claim DoD completion. Two baseline-independent tab-removal regressions remain disclosed in Validation Evidence.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"116","task_workload_id":"dd41c19013f44effb1cd3e5dcb07e4a5"}
<!-- TASK_END_RUNTIME_METADATA_END -->
