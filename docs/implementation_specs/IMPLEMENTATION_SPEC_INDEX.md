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

- Hub shell UI, navigation, local Runner labels, and application themes: source owners `../../src/hub/Hub.tsx`, `../../src/hub/Sidebar.tsx`, `../../src/hub/Workspace.tsx`, `../../src/hub/ThemePicker.tsx`, and `../../src/hub/hub.css`; representative checks `../../tests/e2e/hub.spec.mjs` and `../../tests/e2e/starter.spec.mjs`. Select this direct source/test route for shell behavior; no separate domain index is needed.
- Single Entry assignment/defaults, configured Runner launch, durable tab restoration/recovery, input protocols, local-control observations/settings/shortcuts, reference registration/inventory and native shutdown ownership: [Runner terminal ownership](runner_terminals.md); source owners `../../src/hub/singleEntry.ts`, `../../src/hub/SingleEntryComposer.tsx`, `../../src/hub/RunnerSessions.ts`, `../../src/hub/RunnerWorkspace.ts`, `../../src/hub/RunnerRecovery.tsx`, `../../src/hub/runnerInput.ts`, `../../src/hub/runnerControl.ts`, `../../src/hub/referenceSelection.ts`, `../../src/hub/RunnerReferences.tsx` and `../../src-tauri/src/desktop_terminal/`; representative checks `../../tests/e2e/runners.spec.mjs`, `../../src-tauri/src/desktop_terminal/tests.rs`, `../../src-tauri/src/desktop_terminal/reference_tests.rs` and `../../src-tauri/tests/control_handles.rs`.

## 신규 domain 등록 조건

- 반복 작업에서 책임 경계나 현재 동작을 다시 추론해야 하는 안정된 기능 영역이어야 한다.
- 현재 소스와 집중 테스트 또는 활성 runtime 계약으로 검증 가능한 구현이어야 한다.
- domain index에 선택 조건, 구현 소유 경로, 대표 테스트를 기록해야 한다.
