# Session Report

## 1. Task Info
- Task Number: 25
- Task Title: Runner add tab and native directory browsing
- Task Title (KR): Runner 추가 탭 및 네이티브 폴더 탐색
- Summary: Replace manual creation with a green sidebar add action, unify spare allocation order, and add safe native browsing to directory drafts.
- Summary (KR): 녹색 사이드바 추가 동작으로 수동 생성을 통합하고 예비 Runner 할당 순서를 유지하며 경로 초안에 안전한 네이티브 폴더 탐색을 추가한다.

## 2. Work Plan
- Preserve RunnerSpare ownership, native PTY/control identity, Task 24 work notifications, explicit reuse-idle policy, tab controls and workspace persistence.
- Route manual creation and Single Entry new allocation through the existing sessions allocation decision; append real tabs before an accessible bilingual green plus action and guard duplicate/stale/failed creation.
- Introduce a small shared directory input for installation, Single Entry Direct Root and Runner configuration Direct/Pure Direct Root. Preserve typing and explicit verify/plan/apply; ignore cancelled, failed and stale picker results.
- Extend focused browser coverage for ordering, identity, races, picker draft isolation and both locales/themes; run affected configuration, persistence and native-I/O regressions as available. Record fixture evidence separately from installed-app acceptance.

## 3. Work Summary
- Removed the toolbar New Runner button. Sidebar now owns one green, centered, keyboard-accessible plus action after all real Runner rows, including the empty list, with English/Korean labels, readiness/busy state and Light/Black variants. New selected rows receive focus.
- Manual creation and Single Entry new allocation share RunnerSessions.allocate. A verified ready matching spare is promoted without replacing its process, PTY, control, parser or output; fallback uses the existing fresh launch. Only RunnerSpare replenishes. Real tabs append in creation order before the nonpersisted plus action; rapid concurrent manual clicks are fenced. Failed launches retain one explicit failed tab and diagnostic under the existing recovery contract.
- Added DirectoryInput as the shared native selectFolder UI for installation, Single Entry Direct Root and configuration Direct/Pure Direct Root. Typing, paste and saved paths remain supported. Picker cancellation leaves the draft unchanged; errors stay local; request, lifetime and live owner/draft checks reject stale results. Selection never verifies, plans or applies automatically.
- Preserved explicit reuse-idle, Task 24 work/unread state, rename, middle-click/confirmed closing, durable workspace records, attachments and PTY delivery. Updated existing fixture identity expectations to follow promoted native owners without weakening behavior assertions.
- Updated existing terminal/configuration specifications, their index route and PRD usage text. No new feature specification was needed: the existing owners already describe allocation, persistence and draft boundaries. The exact Workspace project-policy index for AgentRunnerHub was absent; no project-specific policy was loaded.

## 4. Validation Evidence
- npm run build: passed TypeScript and Vite compilation; the existing large-chunk advisory remains.
- npm run test:i18n: passed all four catalog/source checks, including English/Korean interpolation and key integrity.
- Focused browser run: nine checks passed for manual/Single Entry ordering, preserved native output/identity, one spare replacement, rapid click fencing, honest fallback-launch failure, restored order, keyboard access, centered green geometry, all three directory fields in four locale/theme combinations, paste/cancel/error and late-result isolation. Artifacts: test-results/web-app/94db31cc-c6c7-415e-bc46-93a128ef96f4/report/index.html. Light/Black screenshots were inspected.
- Rust with desktop-terminal,native-io: 34 control/configuration/work tests passed; four real isolated PTY lifecycle tests passed; five clipboard ownership tests passed. The initial over-specific configuration filter selected zero tests and was corrected to the real control::tests module. Nine fixture-child/installed-Runner acceptance entries were intentionally ignored by the PTY selection.
- Affected browser regression batch: 233 passed and two fixture failures in the 235-case selection (runners, Hub, preferences, configuration/delivery and work/background/discovery). Artifacts: test-results/web-app/f78b80a1-60a7-4e3e-aa4e-9be23204473b/report/index.html. Corrected the paused-image fixture to hold the promoted first native process and the fallback-failure assertion to expect cleanup of only the deliberately disconnected spare. Both failed cases passed on focused rerun: test-results/web-app/c86fc52b-55ff-408e-9779-4bddb5f98938/report/index.html. Application source was unchanged; the other 233 passing cases do not use either repaired fixture condition, so their evidence remains applicable. An earlier batch was stopped to migrate obsolete fresh-process identity assumptions.
- UTF-8/no-BOM, unchanged-byte spans, LF preservation and existing Korean comment preservation checked on changed files; git diff --check passed. No source-wide EOL conversion or shell-write fallback was used.

## 5. User Verification Message
- Automated browser/native fixture checks are recorded above. Actual installed-app acceptance and real OS folder-picker windows remain unverified: no isolated HUB_RUNNER_ACCEPTANCE_ROOT was supplied. Browser dialog transport simulations and real PTY fixtures do not establish installed Runner/provider or packaged WebView acceptance. On the installed app, check the green plus flow and native folder selection/cancel in English/Korean and Light/Black; keep explicit Verify, Plan and Apply actions. Existing macOS launch restrictions remain unchanged.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"25","task_workload_id":"b0e175d85fe74143a5334ed69c8c0f74"}
<!-- TASK_END_RUNTIME_METADATA_END -->
