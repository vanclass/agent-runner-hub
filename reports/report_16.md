# Session Report

## 1. Task Info
- Task Number: 16
- Task Title: Hub English/Korean localization and local preferences
- Task Title (KR): Hub 영어·한국어 다국어 및 로컬 설정 저장·복원
- Summary: Add i18next catalogs and versioned local Hub preferences while preserving Runner process, workspace, installation, control and reference contracts.
- Summary (KR): i18next 기반 영어·한국어 UI와 언어·테마·검증 가능한 Single Entry 설정의 로컬 저장·복원을 구현하고 기존 Runner 계약을 유지한다.

## 2. Work Plan
- Inspect React/Vite/Tauri UI, Single Entry, workspace/installation persistence and browser/native test owners; consult existing language implementations without runtime coupling.
- Add English-source and Korean semantic catalogs with named interpolation, live updates, translated accessibility/status/error presentation and automated catalog integrity checks.
- Add an independent versioned Hub preferences store with explicit safe projection, read-before-render bootstrap, conservative invalid-data handling and visible save failures; revalidate restored Single Entry choices against fresh Runner evidence.
- Integrate language with Light/Black theme controls; preserve existing assignment behavior and expose no inactive assignment-policy controls. Future assignment default remains always-new.
- Run TypeScript/Vite, full frontend regression, language/layout/restart/failure tests and supported Windows native/CI-equivalent checks. Record unavailable checks and defer actual manual acceptance to later integration validation.
- Update the applicable implementation specification and final report with actual changes, evidence, limitations and reusable preference interfaces. Runner retains report validation and Task-End ownership.

## 3. Work Summary
- React/TypeScript/Vite/Tauri 구조와 Hub, workspace/installation 저장 경계, Single Entry, 제어·복구·참조·이미지 UI 및 기존 브라우저/Windows 테스트를 확인했다. Runner 생산 코드와 네이티브 소스는 수정하지 않았다.
- `src/hub/i18n.ts`와 `locales/en.json`, `locales/ko.json`을 추가했다. English가 원본이며 336개 의미 키와 명명된 변수 치환을 사용한다. `useHubTranslation`으로 화면을 갱신하고, 보관된 Hub 상태·오류는 `HubText` 키/값 메시지로 재표시한다. Runner 출력·응답·사용자 이름·경로·명령·프로토콜 값과 코드 없는 네이티브 진단은 원문을 유지한다.
- `src/hub/preferences.ts`가 독립된 `agent-runner-hub.preferences.v1` 문서를 소유한다. 스키마는 `{ version: 1, language, theme, singleEntry }`이며 초기값은 en/light/빈 선택이다. 렌더링 전에 저장값과 내장 언어 자원을 준비한다.
- Language 선택과 기존 Light/Black 테마를 연결했다. 없는 설정은 기본값을 사용하고, 잘못되거나 지원되지 않는 데이터·읽기 실패·다른 창의 변경은 원본을 보존한다. 쓰기 실패는 마지막 저장값을 유지하고 현재 창에서 적용된 선택과 번역된 경고를 표시한다. 시작이나 초안 편집만으로 preferences를 저장하지 않는다.
- Single Entry의 사용자가 선택한 target, 전체 model tuple, account label, runMode만 명시적으로 검증·복사하여 저장한다. 선택 시 최신 관측값과 일치해야 하며 복원값은 배정 Runner의 최신 설정과 다시 비교한다. 불일치 시 지시문은 미전송 상태로 유지한다. 현재 Runner 관측값을 Hub 기본 설정으로 자동 저장하지 않는다.
- 기존 `agent-runner-hub.workspace.v1`과 `agent-runner-hub.installation`의 키·스키마·복구·설치 검증 계약을 유지했다. 인증키·토큰·PTY 핸들·지시문·초안·불확실한 결과는 새 preferences에 저장하지 않는다. 기존 배정 로직을 유지하고 배정 정책 컨트롤과 예비 Runner 관리를 추가하지 않았다. 향후 기본 정책 always-new는 구현 명세에만 명시했다.
- UI 적용 파일: Hub, Workspace, Sidebar, ThemePicker, RunnerLocation, SingleEntryComposer, RunnerControls, RunnerRecovery, RunnerComposer, RunnerTerminal, RunnerImagePreviews 및 hub.css. 한국어 터미널 검색 레이블의 불필요한 줄바꿈도 수정했다.
- 상태 메시지 적용 파일: RunnerWorkspace, RunnerSessions, singleEntry, runnerControl, referenceSelection, runnerInput, runnerImages, model. 제어·참조·프로세스의 소유권이나 판단 조건은 유지했다.
- 새 파일: `LanguagePicker.tsx`, `i18n.ts`, `preferences.ts`, 두 언어 JSON, `tools/i18n/check.mjs`, `tests/i18n/catalog.test.mjs`, `tests/e2e/preferences.spec.mjs`. 기존 `tests/e2e/runners.spec.mjs`에는 기존 native transport fixture를 재사용하는 회귀만 추가했다. 기존 테스트 삭제/Skip/기대조건 완화는 없다.
- `package.json`/lockfile에 i18next·react-i18next 및 카탈로그 검사 명령을 추가했다. 기존 패키지 버전을 바꾸지 않았다. `.github/workflows/desktop.yml`에 카탈로그 검사 단계를 추가했다.
- 구현 명세 결정: 새 책임의 저장·복원·Runner 권한 분리 설명을 `docs/implementation_specs/hub_preferences.md`로 승격하고 root index에 등록했다. 기존 runner_terminals, ARCHITECTURE, PRD의 관련 범위만 갱신했다. 상세 동작의 단일 설명 소유자는 새 명세다.
- 재사용 인터페이스: `HubLanguage`, `HubTheme`, `HubPreferencesValue`, `HubPreferences.update`, `EntryDefaults`, `projectEntryDefaults`; RunnerSessions는 복원 snapshot과 좁은 저장 callback만 SingleEntry에 전달한다. 향후 Runner 설정 API/배정 기능의 실행 권한을 제공하는 인터페이스는 아니다.
- 참고: AgentRunner의 `settings/language.py`와 `configuration/language.py`에서 English 기본값과 언어 필드별 저장 경계를 확인했다. 제공된 workspace/등록 정보에는 ChatGPT Deck 소스가 없어 해당 구조는 미검토로 남긴다. 프로젝트 간 런타임 의존성은 추가하지 않았다. AgentRunnerHub의 Workspace 프로젝트 정책 index는 없었으며 별도 정책을 생성하지 않았다.

## 4. Validation Evidence
- 최종 `npm run build`: PASS (TypeScript 및 Vite). 기존 대용량 chunk 경고는 비차단으로 남는다. `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: PASS.
- `npm run test:i18n`: PASS. Node 검사 4개 통과, en/ko 336개 키의 동일 구조·비어 있지 않은 값·명명 변수 일치·소스 인자·미사용 키·미번역 JSX/접근성 속성을 검증했다. 누락 키, 변수 불일치, 잘못된 치환, 미사용 키의 음성 테스트가 실패를 탐지한다. 브라우저에서는 누락된 한국어 키의 English fallback도 확인했다.
- 최종 전체 프론트엔드 `npm run test:e2e -- --global-timeout=240000`: 92 passed, 실패/Skip 없음, 정상 종료. 결과: `test-results/web-app/aa58fd36-465f-4357-b6df-7beeac460d28/report/index.html`. 테스트는 기존 프로젝트 fixture에서 실행했으며 전체 실행 한도만 CLI로 확장했다.
- 영어·한국어 × Light/Black, 1400/1000/760/626 폭의 실제 Chromium 화면에서 레이아웃 경계·버튼/입력창 가시성·접근성 이름·선택과 초안 유지·키보드 접근을 검사했다. 언어 변경 중 Runner 생성 수, 원본 Unicode 출력, 현재 Runner 설정, PTY 입력, 참조 확인 결과, 이미지 미리 보기의 유지도 통과했다.
- 저장/복원: 사용자 언어·테마 변경 후 새 페이지 시작, 저장된 한국어의 최초 shell 렌더링(English 선행 화면 없음), 네 가지 Single Entry 선택값의 reload 복원, 초안 미복원을 확인했다. 복원 후 account 불일치는 미전송을 유지했고, 알려진 미전송 배정 해제 후 최신 설정이 일치하면 정확히 한 번 전달됐다. preferences에 지시문이 포함되지 않았고 Runner 관측만으로 기본값을 저장하지 않았다.
- 손상 JSON, 미지원 version/language/theme, 배열형 언어, 제어 문자, 미허용 필드, 읽기 거부, quota 쓰기 실패, 다른 창의 변경을 검사했다. 원본 보존과 현재 창에서의 동작·번역된 경고가 통과했다. 기존 workspace/설치 경로·복구·탭·명령·참조·클립보드·이미지 회귀도 전체 통과했다.
- Windows 네이티브: 기존 사용자 설치 Rust/Cargo 1.90.0을 발견해 명령 자식 환경에서 재사용했다. MSVC 14.44, SDK 10.0.26100.0, WebView2와 로컬 Tauri CLI 2.12.1을 확인했다. 권한 상승이나 시스템 설정 변경은 하지 않았다.
- 기본 `node .runner/web-app-tauri/check.mjs`는 깊은 작업 경로에서 MSVC LNK1104로 실패했다. 설치된 `stageBackend`/`prepareCargo`와 동일 Cargo manifest/의존성/`desktop-terminal,native-io` feature를 재사용하는 짧은 작업 전용 snapshot/output 경로에서 `cargo check` 및 `cargo test --locked`를 실행해 통과했다. 기본 Rust 결과는 58 passed, 0 failed, 기존 ignored 8개다. 로그: `temp/task16-native-results/native-check.log`.
- 사용 가능한 직접 Python 인터프리터를 `HUB_CONTROL_PYTHON`으로 지정해 기존 ignored 대상 중 `exact_handle_allowlist_authenticated_roundtrip_and_eof_uncertainty`를 별도로 실행했다: 1 passed. 전용 자식 프로세스의 인증·핸들 allowlist·이미지 조회·EOF 불확실성을 검사했다. 로그: `temp/task16-native-results/native-protocol.log`. 설치된 실제 Runner/인증된 Codex 사용 수용 검사를 수행한 것으로 간주하지 않는다.
- 최종 Tauri CLI production `build --target x86_64-pc-windows-msvc --no-bundle --ci -- --locked`: PASS. 현재 frontendDist를 포함해 빌드했고 AMD64 PE, 크기, SHA-256 및 프론트엔드 산출물 identity를 검증했다. 실행 파일: `temp/task16-native-results/web-app-native.exe`; 증거: `native-build.json`; SHA-256 `c1ee5ffc257b5ce04c28c015eba1fdc168b936d37f62f3bb62b896b2e15c236d`.
- 수렴 중 기존 복구 테스트가 프로토콜 상태의 표시 변경을 탐지하여 raw `accepted`/`pending-interaction` 값을 복원했다. 관련 5개 집중 회귀가 통과했다. 앞선 전체 실행은 파일 EOF 보정에 따른 Vite reload 및 동시 Cargo 중간 산출물 감시의 EBUSY로 유효한 전체 PASS가 아니었다. 네이티브 검증 종료와 중간 산출물 정리 후 변경 없는 소스에서 최종 92개 전체 PASS를 얻었다.
- 편집 무결성: 신규 텍스트 UTF-8/no-BOM, 기존 LF 및 한국어 CSS 주석을 확인했다. apply_patch가 추가한 RunnerImagePreviews의 EOF 줄바꿈만 캡처한 원래 경계로 복원했고, 모호한 인코딩 파일의 비ASCII 바이트를 그대로 유지했다. `git diff --check`: PASS. 임시 편집/검증 도우미와 Cargo 중간 경로는 정리하고 네이티브 결과 증거만 남겼다.
- CI 범위: 기존 desktop workflow에 번역 검사 단계를 연결했고 로컬에서 frontend/catalog/Windows Rust/Tauri compilation 검사를 실행했다. GitHub hosted Windows/macOS CI 실행, macOS 네이티브 빌드, NSIS installer 생성·설치·서명, 실제 네이티브 WebView의 재시작/수동 사용 및 실제 Runner 인증 기반 이미지 수용은 미검증이다. 실제 수동 수용은 요청대로 후속 통합 검증으로 분리했다.
- Runner 소유의 보고서 검증·canonical completion gate·Task-End 명령은 실행하지 않았다.

## 5. User Verification Message
- 영어/한국어 즉시 전환과 언어·Light/Black 테마·검증된 Single Entry 선택값의 로컬 저장/재시작 복원을 구현했다. 기존 Runner 출력과 프로세스·탭·복구·참조·명령·이미지 계약을 유지했다.
- 자동 검증은 번역 키 336개/카탈로그 검사 4개, 프론트엔드 전체 92개, Windows Rust 58개와 추가 네이티브 제어 fixture 1개, Windows Tauri production 빌드까지 통과했다. 깊은 작업 경로의 기본 네이티브 검사 실패는 짧은 격리 경로에서 동일 빌드 구성을 사용해 검증했다.
- 후속 통합 검증에서는 실제 데스크톱 앱 종료·재실행의 WebView 저장 복원과 실제 Runner 사용을 수용 검사한다. macOS/호스팅 CI 및 installer/서명 검증 결과는 아직 없다. 후속 Runner API와 Single Entry 작업은 `HubPreferences.update`/`EntryDefaults`의 저장 경계와 새 구현 명세를 재사용할 수 있다.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"16","task_workload_id":"3dd27c6bac414c6593e1a1784191d53b"}
<!-- TASK_END_RUNTIME_METADATA_END -->
