# Project Implementation Specification Index

## 목적

이 문서는 새 프로젝트의 구현 명세 선택 진입점이다. 구현 명세는 완료된 현재 동작을 설명하는 snapshot이며, 현재 소스·집중 테스트·설정·활성 runtime 계약이 최종 권위다.

## 권위와 사용 규칙

- 이 디렉터리는 프로젝트 소속 구현 명세만 보관한다.
- 구현 명세는 정책, 미래 설계, 계획, 작업 이력, report 대체물이 아니다.
- 관련 기능을 이해할 때 이 등록부에서 일치하는 domain만 선택하고 디렉터리를 wildcard로 읽지 않는다.
- 구현과 명세가 충돌하면 현재 구현 증거를 우선하고 명세 drift를 수정한다.
- feature 문서는 검증된 구현이 생긴 뒤에만 추가한다.

## 영역 등록부

- Mandatory installation setup, saved-path native verification, startup admission, toolbar app settings and native-runtime browsing diagnostics: [Installation startup gate](runner_terminals.md#installation-startup-gate); source owners `../../src/hub/AppSettings.tsx`, `../../src/hub/RunnerLocation.tsx`, `../../src/hub/runnerInstallation.ts`, `../../src/hub/Hub.tsx` and `../../src/hub/RunnerSessions.ts`; focused checks `../../tests/e2e/installation-setup.mjs`, registered by `../../tests/e2e/runners.spec.mjs`.

- Hub shell UI, navigation, local Runner labels, application themes and responsive task panel: source owners `../../src/hub/Hub.tsx`, `../../src/hub/Sidebar.tsx`, `../../src/hub/Workspace.tsx`, `../../src/hub/TaskPanel.tsx`, `../../src/hub/taskPanel.css`, `../../src/hub/ThemePicker.tsx`, and `../../src/hub/hub.css`; representative checks `../../tests/e2e/hub.spec.mjs`, `../../tests/e2e/task-panel.mjs` and `../../tests/e2e/starter.spec.mjs`. Select this direct source/test route for shell behavior; settings ownership routes to [Runner session configuration](runner_session_config.md#ui-and-evidence-destinations), and running/completion indicators, unread state and tab closing route to [Runner terminal ownership](runner_terminals.md#tab-status-and-closing).
- Hub language, theme and independent Single Entry/per-tab Hub selection initialization and persistence/restoration: [Hub localization and local preferences](hub_preferences.md); source owners `../../src/hub/i18n.ts`, `../../src/hub/preferences.ts`, `../../src/hub/HubSelections.ts`, `../../src/hub/LanguagePicker.tsx`, `../../src/hub/Hub.tsx` and `../../src/hub/locales/`; checks `../../tests/i18n/catalog.test.mjs`, `../../tools/i18n/check.mjs`, `../../tests/e2e/preferences.spec.mjs`, `../../tests/e2e/hub-selections.spec.mjs`, `../../tests/e2e/hub-selection-ui.mjs` and live/restored preference cases in `../../tests/e2e/runners.spec.mjs`.
- Hidden spare preparation/promotion, Single Entry assignment/defaults, configured Runner launch, durable tab restoration/recovery, input protocols, local-control observations/settings/shortcuts, verified generated-image previews, clipboard staging, attachment preflight and reference registration/removal/inventory and native shutdown ownership: [Runner terminal ownership](runner_terminals.md); source owners `../../src/hub/RunnerSpare.ts`, `../../src/hub/runnerInstallation.ts`, `../../src/hub/singleEntry.ts`, `../../src/hub/SingleEntryComposer.tsx`, `../../src/hub/RunnerSessions.ts`, `../../src/hub/RunnerWorkspace.ts`, `../../src/hub/RunnerRecovery.tsx`, `../../src/hub/runnerInput.ts`, `../../src/hub/runnerControl.ts`, `../../src/hub/runnerImages.ts`, `../../src/hub/RunnerImagePreviews.tsx`, `../../src/hub/referenceSelection.ts`, `../../src/hub/RunnerReferences.tsx` and `../../src-tauri/src/desktop_terminal/`; representative checks `../../tests/e2e/runners.spec.mjs`, `../../src-tauri/src/desktop_terminal/tests.rs`, `../../src-tauri/src/desktop_terminal/generated_image_tests.rs`, `../../src-tauri/src/desktop_terminal/reference_tests.rs` and `../../src-tauri/tests/control_handles.rs`.

- Authenticated Runner session configuration, verified current/destination catalogs, explicit plan/apply, per-setting receipts, uncertainty and legacy default conversion: [Runner session configuration](runner_session_config.md); source owners `../../src-tauri/src/desktop_terminal/features.rs`, `../../src-tauri/src/desktop_terminal/session_config.rs`, `../../src/hub/RunnerConfigService.ts`, `../../src/hub/runnerConfigContract.ts`, `../../src/hub/runnerConfigDefaults.ts` and `../../src/hub/RunnerConfigPanel.tsx`; representative checks `../../src-tauri/src/desktop_terminal/session_config_tests.rs`, `../../src-tauri/src/desktop_terminal/session_config_acceptance.rs`, `../../tests/e2e/session-config.spec.mjs`, `../../tests/e2e/session-config-delivery.spec.mjs` and `../../tests/e2e/session-config-ui.mjs`.

- Single Entry allocation/configuration/work integration and original-request start evidence: [Runner terminal ownership](runner_terminals.md#single-entry-assignment), with configuration receipts under [Runner session configuration](runner_session_config.md#preferences-and-single-entry-boundary). API/terminal work discovery, unread indicators and owned tab closing: [Tab status and closing](runner_terminals.md#tab-status-and-closing). Source owners `../../src/hub/runnerWork.ts`, `../../src/hub/RunnerWorkStatus.tsx`, `../../src/hub/RunnerTabClose.tsx` and `../../src-tauri/src/desktop_terminal/work.rs`; focused evidence `../../tests/e2e/work.spec.mjs`, `../../tests/e2e/work-background.spec.mjs`, `../../tests/e2e/work-discovery.spec.mjs`, `../../tests/e2e/runner-work-discovery.mjs`, `../../tests/e2e/single-entry-work.mjs`, `../../tests/e2e/runner-tabs.mjs`, `../../tests/e2e/runner-tab-races.mjs`, `../../src-tauri/src/desktop_terminal/work_tests.rs` and `../../src-tauri/src/desktop_terminal/work_acceptance.rs`.

- Sidebar add action and manual/Single Entry allocation order: [Hidden spare and promotion](runner_terminals.md#hidden-spare-and-promotion). Native browsing for installation and Direct Root drafts: [Directory input integration](runner_terminals.md#single-entry-assignment), with configuration draft behavior under [Runner session configuration](runner_session_config.md#draft-plan-and-apply). Source owners `../../src/hub/DirectoryInput.tsx`, `../../src/hub/RunnerLocation.tsx`, `../../src/hub/RunnerConfigPanel.tsx` and the shell/allocation owners above; focused checks `../../tests/e2e/runner-add-directory.mjs`, registered by `../../tests/e2e/runners.spec.mjs`.

## 신규 domain 등록 조건

- 반복 작업에서 책임 경계나 현재 동작을 다시 추론해야 하는 안정된 기능 영역이어야 한다.
- 현재 소스와 집중 테스트 또는 활성 runtime 계약으로 검증 가능한 구현이어야 한다.
- domain index에 선택 조건, 구현 소유 경로, 대표 테스트를 기록해야 한다.
