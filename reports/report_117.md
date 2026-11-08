# Session Report

## 1. Task Info
- Task Number: 117
- Task Title: Integrate exact recovery lifecycle observation
- Task Title (KR): 정확한 복구 수명주기 관찰 통합
- Summary: Consume Runner recovery.observe evidence to retire completed or discarded references while preserving unfinished automatic recovery.
- Summary (KR): Runner의 recovery.observe 증거로 완료 또는 폐기된 참조를 제거하고 미완료 작업의 자동 복구를 보존한다.

## 2. Work Plan
- Extend the authenticated native recovery adapter and capability negotiation for the unchanged v1 reference and lifecycle v1 observation.
- Add exact-reference pre-restore and later settlement reads to RunnerRecovery through the existing control observation flow, preserving mutation single-flight and workspace save failure behavior.
- Exercise protocol correlation, retained-work lifecycle transitions, persistence failures, compatibility and focused Hub tests; attempt bounded Windows acceptance and explicitly identify any missing actual-work prerequisite.
- Update only affected implementation specifications and record actual evidence and limitations.

## 3. Work Summary
- Extended native recovery requests, additive lifecycle capability discovery and authenticated result validation for recovery.observe, retaining the unchanged v1 reference. Validation covers exact reference/correlation, disposition/flags/ownership, family-owned revision/digest evidence, terminal-state consistency and sanitized codes.
- RunnerRecovery now checks saved eligibility before recovery and observes later settlement through RunnerControl's existing observation loop. Reads are bounded, nonoverlapping and subordinate to foreground/configuration/work admission; background reads do not hold the mutation lock. Generation and ownership-epoch checks reject superseded results. Terminal completed/discarded observations retire through the existing workspace writer; save failures retain the original record and existing failure reporting.
- Preserved legacy recovery, Direct handoff, uncertain/unfinished references, local WorkEvidence ownership, layout and shutdown boundaries. No instruction replay, synthetic replacement completion or independent polling supervisor was added.
- Updated the existing specification docs/implementation_specs/runner_terminals.md and focused protocol, private-pipe, installed-Runner and Hub tests. Existing specification updated because its prior unsupported-lifecycle statement was superseded; the root index route remains accurate. The exact AgentRunnerHub Workspace project-policy index was absent; no project-specific policy bodies were supplied by that lookup.

## 4. Validation Evidence
- PASS: npm run build (TypeScript/Vite), git diff --check and changed-text LF/no-BOM/UTF-8 replacement-character checks. Existing bundle-size advisory remains.
- PASS: final focused browser batch, npm run test:e2e -- tests/e2e/runners.spec.mjs tests/e2e/recovery-lifecycle.spec.mjs tests/e2e/preferences.spec.mjs --grep 'lifecycle|workspace (restores|retains|isolates|saves|excludes)|current lastVerified': 13 passed. Evidence: test-results/web-app/59ebc892-39c4-400b-88c3-05b6dee257c3/report/index.html. Covers Task/Issue retirement without replacement completion evidence, pre-restore completion/discard, stable restored tabs, uncertain results, crossed/superseded/generation results, nonoverlap and failed durable retirement. Existing automatic recovery cases also passed in the earlier focused/expanded runs.
- PASS: supported Tauri backend staging and installed MSVC/Rust environment, cargo test --lib recovery --locked --target x86_64-pc-windows-msvc --features desktop-terminal,native-io: 7 passed, 2 explicitly opt-in checks ignored in this invocation. Final opt-in recovery_acceptance run with --ignored --nocapture --test-threads=1: 2 passed. Dedicated installed Runner returned authoritative in_use, terminal=false, ownership=in_use for the exact current Task reference; fresh native sessions/generations and no-work reference rejection were also exercised. No Provider instruction or recovery of the active Task was submitted.
- PASS: native control_handles regression suite: 70 passed, one opt-in pipe test initially ignored. Final exact_handle_allowlist_authenticated_roundtrip_and_eof_uncertainty run with HUB_CONTROL_PYTHON and --ignored passed, including recovery.observe after Direct successor handoff through real authenticated Windows pipes and a synthetic Runner peer. This is native transport evidence, not retained-work settlement evidence.
- FAILED BASELINE: expanded browser selection had 41 passes, one global-restart provenance assertion failure (expected restarted=2, actual=1), four unrun cases and the suite's aggregate timeout. The exact failing case reproduced both in the candidate and an isolated unchanged HEAD snapshot, with no lifecycle capability or recovery operation involved. This is an unchanged restart-count/fixture obligation outside the lifecycle delta; its assertions and production behavior were preserved. Candidate evidence: test-results/web-app/58ce364e-98ed-40ac-9cbf-c337d652faca/report/index.html. Baseline failure evidence retained under temp/wg4/baseline-failure.
- UNVERIFIED: actual retained TaskRun/IssueRun recovery through later canonical completion/discard and subsequent unexpected native Hub restart. The available real reference belongs to this live Task and remains in use. No supplied or fixture-owned retained TaskRun/IssueRun plus a supported isolated native Hub recovery-to-settlement drive was available. Browser contract simulations and the active-reference native read do not replace that prerequisite or prove actual WebView settlement/retirement.

## 5. User Verification Message
- Implemented authoritative exact-reference lifecycle integration with focused automated and bounded installed-Runner evidence. Actual retained-work native recovery-to-terminal acceptance remains unverified pending an isolated, safely owned retained TaskRun/IssueRun fixture and supported native Hub drive; no manual execution is required for the checks already completed. The unchanged global-restart count assertion remains a separately disclosed baseline failure.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"117","task_workload_id":"d353b3d1bce04cdca04ad2fa1ef7f7cb"}
<!-- TASK_END_RUNTIME_METADATA_END -->
