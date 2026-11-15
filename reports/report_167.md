# Session Report

## 1. Task Info
- Task Number: 167
- Task Title: Confirmed persistent Hub event history
- Task Title (KR): 저장 확인된 허브 이벤트 기록
- Summary: Show only confirmed saved events in Single Entry history; retain external storage failure feedback and existing persistence behavior.
- Summary (KR): 단일 진입 로그에는 저장이 확인된 이벤트만 표시하고 저장 오류 안내와 기존 영속성 동작을 유지합니다.

## 2. Work Plan
- Remove pending-event presentation while preserving the HubLog queue, pending tracking, confirmed history and external actionable error indication.
- Extend existing focused presentation tests for delayed success and failed/unavailable storage, preserving scrolling, formatting and privacy checks. Extend the existing isolated native case's history assertions.
- Update the directly affected Hub history specification. Run focused browser tests, native disk checks and the supported isolated Windows Hub case; report actual-host evidence separately from simulations.

## 3. Work Summary
- Removed temporary pending-event messages and their unused CSS selectors. Confirmed history remains the sole event-row source; the existing external actionable storage alert, serialized queue and pending-event tracking are unchanged.
- Extended the existing browser fixture with controlled delayed success and unavailable outcomes; checked retained rows, exactly-once confirmed rendering, subsequent language/state updates, rejected writes and internal unresolved-event retention. Extended the existing native Hub case to watch for temporary messages during startup/preparation.
- Updated the existing Hub history implementation specification. No changes to persistence schema, retention, event classification, Runner execution or configuration. The exact Target's canonical Workspace project-policy index was absent; no project-specific policy was loaded.

## 4. Validation Evidence
- Focused browser simulation: `npm run test:e2e -- hub-log-presentation.spec.mjs hub-log.spec.mjs` passed all 10 checks. Includes localization, local timestamps, legacy privacy, wrapping/outcome styling, bottom following, historical anchors, older expansion, re-entry, queue ordering and preference retention/reload. Artifacts: `test-results/web-app/5f3a0f69-0085-4ee9-a38b-f4d300fc6c18/`.
- Initial browser invocation lacked local Playwright; `npm ci` restored declared dependencies and the focused rerun passed.
- Actual Windows host: `node tools/native-probe/hub.mjs --case hub-log --runner-root D:/Codex/codex_workspace` passed. TypeScript/Vite build and ordinary Rust library check passed. The isolated Candidate Hub captured startup/spare events without temporary pending messages, retained confirmed rows through tab navigation, followed a live confirmed restart event, and restored history in a fresh native process. Restart evidence: 209 prior records retained, 210 afterward, unchanged formatting/order, seven-day preference retained, no duplicate sequences. Renderer capture confirms the three-column log at bottom without an error; fixture resources were released. Evidence: `temp/native-probe/4c483c08-4d7c-4363-9241-6f007799bd77/hub-log/evidence.json` and `renderer.png`.
- Native disk/retention: `node tools/hub-native.mjs test --test-filter hub_log --target-dir D:/Codex/codex_workspace/agent_runner/runs/workloads/task-run/AgentRunnerHub/167/task-167/local/native-probe/target` passed all three focused Rust tests: restart/order/age cleanup, malformed-history preservation and actual I/O failure preservation. An initial overlapping attempt stopped at the active build lease; no lock was removed. Retrying after lease release passed.
- Evidence boundary: controlled delayed/rejected/unavailable saves were exercised through browser transport fixtures; actual Windows acceptance used native IPC/disk and fresh owned Hub/Runner processes without submitting instructions. No macOS or physical keyboard/focus claim is made.
- `git diff --check` passed. Modified source/test/spec files preserve LF and no BOM, decode as UTF-8 without replacement characters; localized text is intact. Changes remain confined to the authorized presentation, focused tests, specification and active report.

## 5. User Verification Message
- The log now displays confirmed saved event history only. Ordinary saves do not insert temporary messages or false unsaved warnings; actual storage errors remain outside history. Focused browser, native disk and isolated Windows Hub checks passed. No additional user verification is required for the tested scope.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"167","task_workload_id":"1c5c0e237e4f43068c0c8b20e4264dd2"}
<!-- TASK_END_RUNTIME_METADATA_END -->
