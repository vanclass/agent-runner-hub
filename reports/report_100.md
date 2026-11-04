# Session Report

## 1. Task Info
- Task Number: 100
- Task Title: Retire obsolete Hub preference compatibility
- Task Title (KR): Hub의 오래된 환경설정 호환 처리 제거
- Summary: Remove retired shortcut conversions and active account labels while preserving exact identity, independent preferences and current tab recovery.
- Summary (KR): 오래된 단축키 변환과 계정 표시 이름 처리를 제거하고 정확한 계정 식별과 독립 설정 및 탭 복원을 유지합니다.

## 2. Work Plan
- Trace preference projection, explicit saves, account catalog conversion and workspace production/restoration. Remove only obsolete admission behavior; preserve version, atomic/concurrent writes, markers and current lastVerified recovery. Exercise focused browser preference, shortcut, selection and restoration regressions and update affected specifications.

## 3. Work Summary
- Removed explicit Ctrl+Enter-to-Enter and Home-to-Ctrl+Home predecessor conversions. Current maps pass unchanged; unsupported optional saved fields resolve through current defaults, preserving valid independent chords/preferences. Explicit edits retain complete-map validation and atomic saves.
- Removed account-label strings from EntryDefaults, selection UI, conversion and locale messages. Saved label fields are ignored regardless of type or matching display name; exact agent_id/profile_name plus authenticated catalog matching remains authoritative. Shared configured submission now refuses absent exact identity. Label-only records retain initialized intent in memory to prevent automatic account initialization or eager persistence; existing markers and independent selections remain intact.
- Traced HubPreferences projection/update, HubSelections initialization/editing, RunnerSessions selection binding/captureVerified, RunnerWorkspace load/save and prior-context consumption. Retained lastVerified-to-recoveryHint freezing: current captureVerified writes lastVerified without necessarily producing recoveryHint. No tab-format adaptation was proven predecessor-only, so none was removed. Stable UUID/order/install association, existing hints and recovery uncertainty remain preserved.
- Updated existing specifications hub_preferences.md, runner_session_config.md, runner_terminals.md and their root index; no new storage version, migration subsystem or duplicated state owner. Preferences and workspace retain their existing write owners. Project policy canonical index was absent; no project-specific policies loaded. Changes remain within Hub preference compatibility and affected tests/specifications; WG12 API fallbacks and native implementation are untouched.

## 4. Validation Evidence
- Build: npm run build passed on final production source. Dependencies were initially absent (tsc unavailable); npm ci --no-audit --no-fund restored the lockfile-defined toolchain. Existing Vite bundle-size warning remains.
- Browser preference/selection/configuration suites: preferences.spec.mjs, hub-selections.spec.mjs, hub-selection-initialization.spec.mjs and session-config.spec.mjs passed 72 checks (003d074c-353b-4e4d-968b-83f754581520). Added mixed-label independent Single Entry/per-tab restoration/edit test passed separately (1e728a8a-9e1e-4cc7-b656-58468958fa74). Current lastVerified-only read-only load test passed with exact saved-byte equality (9cd8a974-dbe8-45a2-af4c-571a6387a06c).
- Final-source Runner regressions: shortcuts, Hub selections, Single Entry preferences, workspace stable tabs, unsupported/unreadable bytes and rejected atomic writes passed in focused run 638d0022-68b6-4de0-91ee-abdc12b887ed (12 passed; three stale workspace fixture failures repaired subsequently). Matching-label unsent submission passed cde9dc08-a568-43b5-93b3-59284f5c09da. Authenticated session submission checks passed in 0dcd4fd4-f493-4cdf-8ac5-92146e531394 (14 passed; one old-selector failure superseded below); delivery receipt test passed d3cab808-83f2-42f8-a9af-8188f2c4d9b2.
- Workspace history cases passed for fresh bound and unbound contexts, repeated reopen, existing-hint retention and recovery uncertainty (334e30a6-157f-4f03-a41d-21adecedc03f). Malformed/duplicate tab isolation, launch failure diagnostics, order and installation behavior passed after selector correction (9be9fae0-24b6-4d4b-97ee-08a40f7210ff). Observation-only recovery fixture no longer tries submitting /target without work/config capabilities; actual configured submission is covered separately. Initial overbroad run 1529c89f-d699-4181-8c85-17e2b55765a2 timed out and crossed a source edit; its affected results were superseded by focused final-source runs, not counted as acceptance.
- npm run test:i18n passed all four checks and catalog integrity. git diff --check passed; edited text retained LF/no BOM with no replacement characters or broad rewrite drift. Reviewed localized diffs and removed unused label consumers/messages. Historical/current/mixed records, custom chords, reserved actions, modal focus, failed/concurrent preference writes, byte preservation and independent choices have direct browser evidence. Browser artifacts are under test-results/web-app/<run-id>/report/index.html. Packaged WebView persistence and actual native/manual acceptance were not executed and remain unverified.

## 5. User Verification Message
- Hub now ignores retired account labels and uses current defaults for unsupported saved shortcuts without rewriting storage on restoration. Current exact identities, custom shortcuts, independent selections and previous-process tab context remain supported. Focused browser checks and build pass for the affected contracts; packaged WebView acceptance is unexecuted.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"100","task_workload_id":"60f1ed447a334ff7ac0a9b161212dfd4"}
<!-- TASK_END_RUNTIME_METADATA_END -->
