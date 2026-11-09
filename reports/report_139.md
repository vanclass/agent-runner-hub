# Session Report

## 1. Task Info
- Task Number: 139
- Task Title: WG3 normal installed Runner acceptance
- Task Title (KR): WG3 일반 Runner 설치 통합 검증
- Summary: Reuse the verified regular Runner runtime for test-owned background Hub integration, ordinary inspection and local draft selection.
- Summary (KR): 일반 Runner 런타임을 재사용하여 독립 Hub 프로세스의 읽기 전용 통합과 로컬 설정 초안을 검증합니다.

## 2. Work Plan
- Trace installation resolution, authenticated session inspection and WG3 fixtures; replace separate-installation/Test-account prerequisites with an existing installation selector.
- Preserve runtime/session/process ownership and WG1/WG2 infrastructure. Exercise verified catalog selections only in the isolated Hub draft and correlate completed read-only receipts.
- Run focused WG3 fixtures, affected headless checks and Windows native WG1/WG2/WG3 cases; record actual acceptance, cleanup and precise unavailable prerequisites separately. Update operational/specification documentation.

## 3. Work Summary
- Replaced the WG3 separate-installation selector with --runner-root for the existing normally configured workspace. Removed saved Test-account and execution_context:test requirements from both acceptance cases; ordinary Hub/Runner source and shared WG1/WG2 infrastructure are unchanged.
- Verified the existing managed Python and registered Runner source at D:/Codex/codex_workspace, then used the actual Hub installation form/native resolver. Each case used a fresh hidden Hub/profile and its normal session owner, without adopting existing sessions or copying profiles/credentials.
- Corrected native observation instrumentation: actual Tauri invoke is immutable. Observe the existing callback map's Hub-owned PTY event IDs, forward callbacks unchanged, discard terminal bytes, and inspect that exact session. Synthetic writable-invoke fixtures remain explicitly separate evidence.
- Configuration selection verifies ordinary authenticated account/model/run-mode candidates, persists only the isolated Hub draft and checks unchanged native revision. Read-only acceptance correlates session/generation/completed receipts and effective settings while respecting legitimately unbound UI selections. No configuration apply or work submission is performed.
- Updated native-probe operational guidance and native automation specification. Project policy index at the exact AgentRunnerHub Workspace environment was absent; no project-specific policies were selected.

## 4. Validation Evidence
- PASS: 29 focused Node tests across wg3, lifecycle, platforms, native-probe and hub-native. Covers immutable-invoke callback observation/restoration, installation/capability binding without Test selection, ordinary inspection rejection, stale generations, receipt correlation, blocked prerequisites and uncertain responses without replay.
- PASS: npm run test:e2e -- runners.spec.mjs --grep "WG3 simulated|installation setup:"; 10 checks, including explicit unbound account/model drafts. Final browser artifacts: test-results/web-app/31e5e563-13e4-490f-843e-59c54045ed30.
- PASS actual Windows: node tools/native-probe/hub.mjs --case configuration-selection --case runner-read-only --runner-root D:/Codex/codex_workspace. Evidence: temp/native-probe/37577150-1671-452c-9953-fb2c45fbbb79/{configuration-selection,runner-read-only}/evidence.json. Independent Hub PIDs 25696 and 20124 each bound owned native session 0, generation 1; configuration receipts 3 and 9 and read-only receipt 6 were accepted/completed. Native revisions remained unchanged; read-only UI account/model were legitimately unbound. Both exited 0 without forced cleanup or activation, listeners released and resourcesReleased=true.
- PASS actual Windows WG1/WG2 compatibility and installation-entry in temp/native-probe/944a8011-00c1-444e-b960-fab46ceb07c7: renderer-probe, language-preference and installation-entry. Ordinary library check and ordinary dependency graph excluding WebDriver passed in native builds; TypeScript/Vite build passed.
- Retained failed observations: initial WG3 native attempts timed out with the obsolete immutable-invoke observer; diagnostic attempt 9bcd5b9f-9af9-4c04-a5ea-5ca3911cb965 remained unverified. The callback-map repair produced the later actual acceptance above; all these attempts settled their owned processes/resources normally.

- Additional headless regression command for session-config.spec.mjs and hub-selection-initialization.spec.mjs: 40 passed, 1 failed (unbound native startup expected accountIdentity but received no initialized identity); artifacts test-results/web-app/054a3fc8-2a5b-41e5-b704-836af1725897. That isolated test imports unchanged ConfigFixture, HubSelections and runnerConfigDefaults, not the changed WG3 cases. No production behavior or shared fixture was altered to satisfy it; it is a separate preserved regression failure, not a WG3 acceptance pass.
- An overly broad browser grep also selected submission tests: 21 passed, 7 failed, 55 not run before the 120-second suite timeout (b520aa2c-2b37-4b7b-99e8-5bc8d74e472e). Failures concerned missing m2 options and Runner instructions controls in unchanged submission paths. Subsequent verification used exact required modules and WG3 selectors; those failures remain failed and outside this read-only implementation delta.
- Fixture convergence retained initial synthetic failures (inconsistent effective selection and then an unbound-case locator matching two selects); corrected only the focused WG3 fixture and reran successfully. Final modified text preserves LF and no BOM; git diff --check passed. macOS native integration remains unverified; work admission/start were not exercised.

## 5. User Verification Message
- WG3 actual Windows read-only acceptance now succeeds with the normally installed Runner and ordinary authenticated startup account. No second installation or saved Test account is required. Use --runner-root with the normal Runner workspace root for the fresh test profile.
- Work admission/start, configuration apply, macOS native integration and packaging remain unexercised. Separate existing configuration/submission test failures are retained below; no full-suite success is claimed.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"139","task_workload_id":"40f19b4855034eedac5f5bb5ebf65f2e"}
<!-- TASK_END_RUNTIME_METADATA_END -->
