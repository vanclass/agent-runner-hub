# Session Report

## 1. Task Info
- Task Number: 273
- Task Title: Reconcile retained Runner recovery and restart outcomes
- Task Title (KR): 러너 복구 참조와 재시작 결과 정합성 개선
- Summary: Verify and restore legacy exact references, report restoration separately from replacement launch, and check the idle-reuse boundary on tab removal.
- Summary (KR): 기존 복구 참조를 검증하여 복원하고, 교체 실행과 컨텍스트 복원 결과를 구분하며, 탭 제거 시 유휴 러너 재사용 조건을 점검한다.

## 2. Work Plan
- Trace reference verification, workspace persistence, and restart settlement through their existing owners.
- Reconcile mode-less exact references from authenticated evidence before recovery. Preserve unresolved references and keep history replay independent of adoption.
- Check whether tab removal can bypass connected-context capture, then exercise the affected paths in background browser fixtures and update the terminal ownership specification.

## 3. Work Summary
- Confirmed that mode-less exact references stopped before observation. Recovery now verifies the persisted identity, ownership, eligibility and supported Base Run Mode through `recovery.observe`. It checks for conflicting historical modes and commits the verified mode and reference through the existing `RunnerWorkspace` save path before admitting recovery. Unresolved legacy references keep their original evidence.
- Confirmed that global restart could count a usable replacement as a restored context. The batch now distinguishes context adoption, mode-only restoration, failed restoration and uncertain restoration. Failed and uncertain restoration leave the replacement and its actionable diagnostics available. Terminal-history replay retains its independent status.
- Confirmed that retirement could cancel an unfinished capture and admit idle reuse with an attached context. Supported removed sessions now require a fresh authenticated empty-context result before reuse. Unsafe or unresolved release follows the existing exact-session termination path.
- Inspected the workspace projection, hidden/spare restart ownership and history replay boundary. The workspace already retained well-formed references with no mode. Hidden and speculative restart readiness and native replay required no implementation changes.
- Updated the existing `runner_terminals.md` and `hub_logs.md` specifications. Their index routes remain valid. The exact Target has no registered project-policy index.

## 4. Validation Evidence
- The first headless Chromium batch passed all 13 checks. It covered the four legacy Base modes, conflicting and unavailable evidence, normal recovery, mode-only restoration, blocked and uncertain results, incomplete and unavailable replay, and isolated removal while context capture was delayed.
- The second headless batch passed 14 checks, including legacy save failure before admission, workspace rollback, stale observation, replacement readiness and revocation, cleanup and launch failure, and released idle reuse. One historical-provenance assertion referenced accessors already absent at the baseline. The corrected fixture now verifies the persisted hint through the current tab projection. Its rerun and the six restart-outcome checks all passed.
- `npx --no-install tsc --noEmit`, `npm run test:i18n`, and `git diff --check` passed. The catalog checks covered both English and Korean restoration diagnostics.
- Reused task 272's installed Runner evidence for authenticated connected recovery, native retained-work adoption, Direct successor handoff and successful adoption with missing replay. Fresh installed-Runner, native WebView and Provider runs were outside this focused regression pass. The compatibility, classification and removal changes were observed through production Hub orchestration with simulated native transport.

## 5. User Verification Message
- A previously saved exact reference can recover when Runner verifies its eligible Base Run Mode. If global restart opens a replacement but cannot restore its context, the replacement tab and the restart summary show the recovery reason.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"273","task_workload_id":"9e012a5b3bc04116b071a7e4a7040989"}
<!-- TASK_END_RUNTIME_METADATA_END -->
