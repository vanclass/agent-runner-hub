# Session Report

## 1. Task Info
- Task Number: 45
- Task Title: Correct restart revalidation and replacement readiness attribution
- Task Title (KR): 재시작 재검증 및 교체 Runner 준비 상태 판정 수정
- Summary: Bound pending revalidation and require authenticated usable replacements while preserving process and work ownership.
- Summary (KR): 프로세스와 작업 소유권을 유지하면서 대기 중 재검증을 제한하고 인증된 교체 Runner의 준비 상태를 확인한다.

## 2. Work Plan
- Reproduce unchanged eligible readiness with pending verification in focused production-owner tests.
- Gate revalidation on meaningful readiness changes or bounded existing authenticated observations; retain one unresolved attempt.
- Require replacement control/readiness confirmation for visible, hidden and speculative paths, retaining failed resources and original logs.
- Exercise delayed readiness, disconnect, initialization failure, owner revocation and existing whole-work/removal/shutdown safety; run restart, native-control, localization and build regressions.
- Observe native Windows acceptance only with a verified task-owned isolated authenticated installation; otherwise record it as unverified.

## 3. Work Summary
- RunnerRestarts now parks pending verification after sampling its settled state. Material owner/observation changes or bounded existing authenticated observations can revalidate; verification's own busy/receipt notifications cannot continuously reschedule it. One unresolved attempt remains in flight, with the existing concurrency limit preserved.
- RunnerSessions rejects unsuccessful current work inventory inspection instead of accepting an earlier result. Unknown work.list admission remains pending until existing owner-confirmed recovery. No work owner is forcibly terminated to satisfy restart readiness.
- Visible/hidden replacements wait on existing owner notifications for authenticated control, negotiated input and usable safe idle after PTY initialization. RunnerSpare applies the same completion requirement and retains failed replacements through its existing failure owner. Removal and shutdown revoke pending completion.
- Preserved process/Job ownership, native/public transport, whole-work release, stable tab identity, unsent drafts, Hub selections, attachments and exactly-once work submission. No new polling subsystem or process-management architecture was introduced.
- Extended tests/e2e/runner-restarts.mjs for unchanged readiness, failed/recovered work and reference inventory, stale observations, transient errors, unresolved/unknown admission, delayed readiness, disconnect, post-open failure and revocation across visible, hidden and speculative paths.
- Specification decision: updated docs/implementation_specs/runner_terminals.md, Global Runner restart, to describe bounded revalidation and authenticated replacement completion. Existing index and source/test destinations remain accurate. The exact Workspace Project policy index for AgentRunnerHub was absent; no project-specific policies were loaded.

## 4. Validation Evidence
- Baseline reproduction: executed the original RunnerRestarts implementation against a bounded eligible target that always returned pending. It invoked verification eight times without a readiness change before the probe disposed it. The focused regression now observes one unchanged attempt and a second attempt only after a readiness transition.
- PASS: npm run test:e2e -- --grep 'global restart' --global-timeout 300000: 47 passed. Current-source simulated native/production-owner evidence covers pending single flight, bounded/recovered inspection, stale/unknown observations, all replacement paths, DirectRun/TaskRun/IssueRun release, exactly-once submission, failure logs, concurrent removal, shutdown, tab/settings/draft preservation and English/Korean Light/Black UI. Artifacts: test-results/web-app/3b21b7bb-e36b-454a-89ca-5c2a0f52f80b/report/index.html.
- PASS: focused removal/reuse/promotion regression command selected five tests, all passed, including hidden allocation, Single Entry reuse, failed/unconfirmed termination logs and completed-work/image promotion. Artifacts: test-results/web-app/f68487a7-fed4-4f75-9c2b-faa855ca7cc2/report/index.html.
- PASS: cargo test --manifest-path src-tauri/Cargo.toml --features desktop-terminal --test control_handles -- --include-ignored, using installed Cargo by absolute path and HUB_CONTROL_PYTHON bound to the installed direct Python interpreter: 40 passed, including actual fixture-owned Windows private-pipe authentication, handle allowlisting and EOF uncertainty. This is protocol-fixture evidence, not installed authenticated Runner restart acceptance.
- PASS: cargo test --manifest-path src-tauri/Cargo.toml --features desktop-terminal --test runner_job: three passed, one intentionally ignored bounded child entrypoint. Fixture-owned Windows Job containment, detached descendants, separate sessions, root exit and final-handle cleanup were exercised.
- PASS: npm run test:i18n: four catalog tests plus English/Korean source/catalog integrity. PASS: final npm run build (TypeScript and Vite); existing large-chunk advisory remains. PASS: git diff --check and LF/no-BOM/non-ASCII preservation checks on changed source, tests and specification.
- Diagnostic convergence: the first new-case run had four failures. Work inventory inspection exposed the missing current-result check and was corrected; late fake-clock setup was replaced with real existing observation cadence, and speculative failure teardown now asserts the existing unconfirmed-cleanup error rather than treating it as success. The focused repair run passed; final current-source restart and reuse runs above passed. The native-generated untracked Cargo.lock was removed after tests.
- UNVERIFIED: exact native Windows restart flow against a task-owned isolated authenticated Runner installation. HUB_RUNNER_ACCEPTANCE_ROOT was not supplied and no verified task-owned isolated installation was available. No shared Runner was operated on; browser transport simulations and native protocol/Job fixtures do not substitute for this acceptance boundary.
- Scope review: only the three restart/session/spare owners, directly affected restart tests, canonical specification and active report changed. Process management, public native protocol and work submission architecture remain unchanged. Runner-owned report validation and task-end gates were not invoked.

## 5. User Verification Message
- Restart verification now waits safely, and restart success requires authenticated replacement readiness. Focused restart, work/reuse/removal, native-control/Job, localization and build checks passed. Exact installed-Runner Windows restart acceptance remains unverified because the task-owned isolated authenticated installation prerequisite was absent.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"45","task_workload_id":"632790ebf1a44bbab1bc5a09315f3056"}
<!-- TASK_END_RUNTIME_METADATA_END -->
