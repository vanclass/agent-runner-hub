# Session Report

## 1. Task Info
- Task Number: 9
- Task Title: Retain historical Runner context across Hub restarts
- Task Title (KR): Hub 재시작 간 이전 Runner 컨텍스트 보존
- Summary: Separate retained historical recovery hints from fresh Runner observations in the existing Hub workspace manifest and recovery display.
- Summary (KR): 기존 Hub 워크스페이스 매니페스트와 복구 화면에서 이전 복구 힌트와 새 Runner 관찰값을 구분하고 보존한다.

## 2. Work Plan
- Reproduce saved Project/Target A being replaced by fresh different or unbound B, then fix the existing persistence owner with a minimal explicit historical projection compatible with version-1 tabs.
- Keep current settings canonical and recovery unconfirmed; retain hints across repeated reopening and legitimate setting changes, including completed /recover commands.
- Extend focused workspace/recovery regressions for compatibility, malformed records, interrupted writes, stable tab order, dormant tabs and absence of replay. Preserve all process/control lifetime and shutdown contracts.
- Build and run affected frontend and desktop checks, observe the changed display in an isolated Windows Hub, distinguish injected metadata from native observations, and update the existing terminal specification and this report with exact evidence.

## 3. Work Summary
- Fixed the loss path in the existing RunnerWorkspace owner. Version-1 records now support an optional explicitly projected recoveryHint; load promotes a legacy lastVerified value only when no hint exists, before fresh launch. Later observations continue updating lastVerified without replacing the retained hint.
- RunnerSession presents the retained hint through previousContext. RunnerRecovery labels the historical target, binding, run mode and workflow as previous-process context, states that work recovery is unconfirmed, and points to current settings below. Current settings still read only the fresh control snapshot.
- Kept tab IDs/order, restoration idempotence, launch intent, dormant tabs, atomic replacement, malformed-record isolation and unsupported-manifest retention. No new recovery authority, recovery receipt, replay, persisted instructions/private capability, scheduler, media integration or macOS behavior was added.
- Model decision: keep the two lifetimes in the existing persistence owner, using the same minimal nonsecret context type. A single overwritten snapshot loses history; freezing current settings would misrepresent the fresh Runner. The retained hint has no retirement transition because the public control contract supplies no authoritative historical-work recovery receipt. /recover completion does not change that.
- Existing specification updated: docs/implementation_specs/runner_terminals.md, Durable workspace and recovery. Its existing root-index route and architecture/PRD references remain accurate. The AgentRunnerHub Workspace project-policy index was checked and absent.

## 4. Validation Evidence
- Reproduced the visible loss before the fix in both different-target and unbound-target simulations. On the second reopening, the historical display showed Project / Changed C instead of Project / Historical A. Evidence: test-results/web-app/882d710a-e05d-438e-b2cd-dbc9a3a0ddc9 (two expected failing regressions). An earlier schema assertion also confirmed the missing separate hint: deb39df4-67f9-40cd-ab83-e0f37b3a49ce.
- Frontend build: npm run build passed. Focused workspace/recovery checks: 10 passed (14b295e6-cc93-4b88-8985-e174477783b1). Runner frontend regressions: all 35 passed (a5649cb2-633b-4f57-a6f1-1b6557004f48), covering shared session updates, settings, commands, assignment, input and keyed views. The later expanded dormant-hint/private-field case passed separately (744cc4e2-9a31-439f-8831-4d82b381fafd); its initial overly specific expected status was corrected to the relevant disabled/current-target assertion.
- Simulated values: A = bound Project / Historical A, issue-run, IssueRun. B variants = bound Project / Fresh B or unbound with empty owner/project; both task-run with empty workflow. C = bound Project / Changed C, direct-run, empty workflow. Both variants executed three reopenings without duplicate tabs, input writes or replayed commands after each reload. The UI retained A and unconfirmed recovery while current settings displayed B or the legitimate C setting change.

| Simulated point | Persisted lastVerified | Persisted recoveryHint | Current settings |
| --- | --- | --- | --- |
| Original version-1 save | A | absent | A |
| Reopen 1 | B | A | B |
| Setting change and accepted /recover SUCCESS | C | A | C |
| Reopen 2 | B | A | B |
| Reopen 3 | B | A | B |

- Compatibility/failure evidence includes prior version-1 records, malformed hint isolation, invalid/duplicate records, truncated/unsupported manifests, a rejected atomic write followed by reopen, dormant history-only records, stripping nested private fields, five-tab stable identity/order and empty drafts/results/no replay.
- Source preservation: captured originals matched HEAD for all five edited tracked files; localized changes preserved LF-only bytes, no BOM and every pre-existing non-ASCII line. No Korean source comments changed.
- Windows desktop checks: node tools/hub-native.mjs test --target-dir <task>/temp/c passed cargo check, 13 library tests, 7 control/startup tests and 3 Job/startup tests. The five ignored installed/child/explicit-interpreter entrypoints were not counted as passes. Evidence: temp/task9-native-test.log. node tools/hub-native.mjs build --target-dir <task>/temp/c passed and produced the current-source debug executable; this is compilation evidence, separate from native GUI observations below. Evidence: temp/task9-native-build.log.
- Prepared Rust/Cargo 1.90.0 only under task-owned temp using the official Windows MSVC archive, independently verified SHA-256 a2db311d0ac032a97717c9280d85fc31d6ccc34b330f8a095b63a1bc042744f6. Reused installed MSVC/SDK/WebView2; changed no global toolchain defaults or host security settings. The first compressed random-access extraction was safely stopped and replaced with one decompression pass; both unneeded archive files were removed afterward.
- Actual Windows native observation used the current-source executable, an isolated WebView2 profile, captured process IDs/creation identities, loopback-only observation endpoints and the real installed Runner. No transport mocks or historical metadata injection were used. Selected Project / MarkdownPDFBuilder through the canonical /target terminal menu and observed the authenticated bound value saved before closing. Native A = bound Project / MarkdownPDFBuilder, task-run, empty workflow. Native B = binding_state unset, empty owner/project, task-run, empty workflow, displayed as Unbound. Native C = bound Workspace / codex_workspace, task-run, empty workflow, chosen through /target in the first fresh process.

| Native point | Hub root | Persisted lastVerified | Persisted recoveryHint | Current target |
| --- | --- | --- | --- | --- |
| Original verified save | 14780 | A | absent | Project / MarkdownPDFBuilder |
| Reopen 1, authenticated | 25564 | B | A | Unbound (unset) |
| Legitimate setting change | 25564 | C | A | Workspace / codex_workspace |
| /recover menu closed, accepted SUCCESS | 25564 | C | A | Workspace / codex_workspace |
| Reopen 2, authenticated | 13336 | B | A | Unbound (unset) |
| Reopen 3, authenticated | 9020 | B | A | Unbound (unset) |

- All native cycles retained one tab, UUID f1b17689-5759-4a2a-8c64-b3ab364643f8 and creation order 1. Each new Hub allocated its own PTY 0; this number is root-scoped, not a restored process identity. Each fresh snapshot was authenticated/fresh with empty command results, empty draft, INTERACTIVE_READY, no owned execution and no workflow. All four captured Hub roots exited with code 0 after WM_CLOSE to the uniquely identified owned Tauri main window. The initial observation helper was relaunched with an input-capable tool session before exercising Runner flows; its empty bootstrap window was closed separately.
- The native recovery panel visibly preserved A, labelled it previous-process context and kept Historical work recovery is unconfirmed while current settings showed B or C. Canonical /recover reached pending-interaction; Escape yielded accepted/SUCCESS for the menu command without admitting historical work, changing the hint or fabricating a recovery receipt. Final native evidence assertions passed. Evidence: temp/task9-native/observations.json; scoped images native-current-C-history.png, native-current-C-target.png, native-reopen3-history.png and native-reopen3-target.png in the same directory. The observation record omits account text and terminal transcripts.
- Evidence boundary: different bound B, nonempty workflow history, malformed/interrupted storage, duplicate records, dormant tabs and five-tab repetition are simulated frontend checks. The real Windows run covers verified Project A, unbound fresh B, current setting C, accepted recovery-menu exit, three reopening cycles and the changed rendered distinction. Historical work admission/continuation was not exercised or claimed; installer packaging and macOS were not tested.
- Existing report_8.md Windows five-Runner forced-exit/reopen, disjoint native/control identity cohorts, normal GUI close and sentinel isolation evidence remains applicable to process lifetime. The current delta changes only retained metadata and its display, leaving native backend, session open/dispose, launch and shutdown logic unchanged. Current five-tab frontend regression and desktop process tests passed; the unchanged abnormal process-lifetime acceptance was not rerun.
- Cleanup limitation: automatic approval review rejected removal of the task-local native profile/helpers and unscoped captures with blocked by policy before execution. No alternate deletion was attempted. These ignored artifacts and build/tool caches remain; all four observed Hub roots were already normally closed. Scoped report evidence uses the sanitized record and dedicated screenshots.

## 5. User Verification Message
- Historical recovery hints now survive fresh default observations, legitimate setting changes, accepted /recover menu commands and repeated Hub reopenings. Current settings remain canonical and historical work recovery remains explicitly unconfirmed. Frontend regressions, affected desktop checks and three actual Windows reopening cycles passed; no user-only verification is required for this scoped fix.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"9","task_workload_id":"8b7f396f4b2b4f41b47794eaf34b940a"}
<!-- TASK_END_RUNTIME_METADATA_END -->
