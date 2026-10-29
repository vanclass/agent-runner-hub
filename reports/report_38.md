# Session Report

## 1. Task Info
- Task Number: 38
- Task Title: Initialize and restore independent Hub execution selections
- Task Title (KR): 독립적인 Hub 실행 선택 초기화 및 복원
- Summary: Use authenticated ordered options to initialize unsaved Hub selections, preserve saved choices, and keep Single Entry and Runner tabs independent.
- Summary (KR): 인증된 옵션 순서로 미저장 Hub 선택을 초기화하고 기존 선택과 탭별 독립성을 보존한다.

## 2. Work Plan
- Trace HubPreferences, Single Entry, RunnerConfigService and spare readiness; preserve installation, session, work, storage and WG1 presentation contracts.
- Share a Hub selection owner and controls between Single Entry and Runner tabs. Initialize atomically from complete authenticated candidates, including the first account's own model catalog; retain partial and unsupported saved values.
- Persist only nonsecret requested selections through HubPreferences. Restore locally, fence delayed results against edits, and retain explicit Runner plan/apply without initialization effects.
- Add focused initialization, dependency, restore, failure and tab-isolation coverage; run preferences/configuration/Single Entry/task-panel/localization/build checks and record actual-host limitations.

## 3. Work Summary
- Added HubSelections as the single requested-selection owner, shared by Single Entry and each Runner tab. RunnerSessions only composes owners and readiness; HubPreferences remains the sole persistence writer.
- Initialization uses the existing authenticated RunnerConfigService.inspect on the admitted ready spare or suitable session, then inspects the first candidate account's complete paged catalog. It chooses the first returned target/account/run mode/model/reasoning/tier and commits one nonsecret projection. It never reads current/effective/next settings as defaults and never invents a Direct Root.
- Restored and partial selections skip initialization. Unsupported saved values stay visible; catalogs load on interaction or explicit plan/submission verification. New tabs copy saved Hub defaults and retain independent selections under their Hub UUID across switches/restart.
- Selection edits invalidate reviewed plans without applying or submitting. Existing explicit plan/apply and Single Entry assignment behavior remain; missing Direct Root is unresolved until explicitly supplied. WG3 submission redesign, WG4 attachments, WG5 removal and WG6 restart were not implemented.
- Updated existing preference/configuration specifications and the root route to the shared owner and new focused tests. No project policy index exists at the exact AgentRunnerHub policy environment; no project-specific policies were loaded.
- Representation decision: reuse EntryDefaults and the existing strict preference projection as the canonical nonsecret representation; HubSelections owns live requests and HubPreferences owns serialization. Compared with copying observed Runner settings or synchronizing two independent forms, this keeps one selection writer and native React select/input behavior. Creation, editing, clearing, restoration and plan/submission mapping are affected; text editing, clipboard, history and terminal rendering retain their existing owners. Removed the obsolete observed-setting form, its styles and unused locale entries.

## 4. Validation Evidence
- Browser simulation: ordered initialization committed exactly Workspace (empty project), codex/second, pure-direct-run, s0/high/fast, initialized=true and no root; the selected account's paged requests completed before one save. The integrated Hub fixture separately committed Workspace, codex/first, pure-direct-run and m0/medium/default automatically.
- Initial focused preferences/configuration/initialization batch: 49 passed and one obsolete missing-root expectation failed; the expectation was updated for explicit Direct Root validation. Configuration/task-panel UI batch then passed all 12 checks, including account identities, explicit plan/apply, late receipts, partial outcomes, tab independence, English/Korean and Light/Black geometry.
- Integrated startup/restart/tab test passed: each tab inherited saved Hub defaults, saved independent changes, restored without any startup inspect, and retained an unsupported model after a changed catalog was explicitly fetched. Initialization/editing requests contained only inspect, with no session_config.apply or work.submit.
- Final domain/preferences/configuration batch: 51 passed; its remaining exact-identity mapping case also passed in a focused rerun after updating the final missing-root assertion. Coverage includes unavailable/incomplete/stale catalogs, destination-account dependencies, delayed edits, unsupported/partial restoration, storage failure/concurrency and rejection of sensitive per-tab fields. Evidence: test-results/web-app/1fcb58e1-daff-46b9-b896-b2d7eabc706b and b6889c66-b17f-4869-8be1-1258537083dc.
- Final UI/regression batch: 27 passed, including WG1 searchable retained scrollback, explicit configuration receipts, task-panel geometry and directories in both locales/themes. The two remaining fixtures passed exact reruns after waiting for initialization readiness and explicitly refreshing after a deliberate allocation edit cancelled initialization. Evidence: test-results/web-app/4003a19c-6ad3-4607-b00f-03613dd5fe20, 6aeb6d2d-36bb-47f6-9adf-da19872a2c41 (manual promotion pass) and 93aa95fe-e26d-422d-b0f1-ebfbac0cb9b1 (saved Single Entry restoration pass).
- Additional work/Single Entry regression batch recorded 24 passes, including reuse, concurrent assignment, start/uncertainty, all Run Modes and confirmation/inventory boundaries. Seven outdated Root/selectors/readiness fixtures failed in that batch and were corrected and covered by the final UI/exact reruns above. A prior aggregate hit the fixture's 120-second bound; unrun tests were never treated as passes. No canonical Runner completion gates were run.
- Final npm run build and npm run test:i18n passed. Vite retains its existing large-chunk advisory. Screenshot review covered restored independent selections and Korean/Black explicit receipts; all three final focused UI checks passed after the readable retained-label adjustment (test-results/web-app/36b15ba2-0cee-49e7-9c00-8269d2ab5c45).
- Native readiness observation only: Windows Rust/Cargo, MSVC, Windows SDK and WebView2 were detected by the installed Tauri inspector; the project-local Tauri CLI was not prepared. No isolated authenticated Tauri UI/provider fixture or native UI automation interface was provisioned. Actual provider catalog, packaged WebView restoration/interaction and real authenticated host behavior remain unverified; synthetic catalogs/browser screenshots are not host acceptance.
- Minimal primary patches preserved LF and BOM state; UTF-8/no-BOM/LF was explicitly verified for new sources/tests. Locale encoding detector confirmed UTF-8; ASCII specifications remain encoding-ambiguous and were edited only in exact ASCII spans. No shell fallback or EOL normalization was used.

## 5. User Verification Message
- Hub now saves authenticated first choices automatically and restores independent Single Entry/tab requests locally. Existing and unsupported selections are retained; Direct modes need an explicit Root. Initialization and edits never apply configuration or submit work. Focused browser/build/localization evidence is recorded above; actual authenticated Windows Tauri/provider UI acceptance remains unverified because no isolated authenticated UI fixture was provisioned.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"38","task_workload_id":"47f14e38624543e880051a1a259dfbd0"}
<!-- TASK_END_RUNTIME_METADATA_END -->
