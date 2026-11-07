# Session Report

## 1. Task Info
- Task Number: 112
- Task Title: Restore Runner domain navigation and add buttons
- Task Title (KR): Runner 도메인 탐색 및 추가 버튼 복원
- Summary: Preserve visible sessions across display modes and confirmed starts; restore domain-local add styling.
- Summary (KR): 표시 모드 전환과 작업 시작 시 세션을 보존하고 도메인별 추가 버튼을 복원한다.

## 2. Work Plan
- Trace navigation projection, confirmed work observations, session settings context and Sidebar composition.
- Repair provisional placement and confirmed-start movement within existing owners; preserve UUIDs, processes, settings, drafts and history.
- Restore the historical full-width Light/Black add button and remove the generic by-mode heading.
- Update the navigation specification and focused behavior/presentation tests; record browser and native-host evidence limits.

## 3. Work Summary
- RunnerNavigation now projects domains from confirmed history plus existing tab placement. Requested/last-verified context seeds provisional affinity; context-free tabs use Task Run without fabricated history. Empty by-mode navigation omits the generic Runner heading and count.
- RunnerSessions forwards existing selection/context data; Hub supplies actual visible session ownership to Sidebar for counts. Existing confirmed-start observation moves the same tab after submission, preserving its session, terminal, settings and selection. No allocation, preload or automatic recovery behavior changed.
- Restored the exact pre-management-move add CSS from 56bd5bb^: full width through nav-row, 48px height, centered 32px plus, Light/Black colors and hover behavior. Buttons follow each domain list; management stays right-aligned.
- Model decision: retained RunnerNavigation as the sole presentation owner and RunnerWork as confirmed-start authority, using the existing affinity record rather than a second display ledger. Native/session and persistence owners remain unchanged.
- Existing specification updated: docs/implementation_specs/runner_navigation.md; its root-index route remains accurate. Focused tests now reject disappearing tabs, header-mounted add buttons and 28px styling. Exact project policy index was absent; no project-specific policies loaded.

## 4. Validation Evidence
- npm run build: PASS (TypeScript and Vite; existing large-chunk warning).
- Focused navigation run: 10 passed; artifacts test-results/web-app/9675f022-39f0-48b4-8590-d22dd315b1aa/report/index.html. Covers confirmed history, unknown/conflicting evidence, persistence, drag ordering, keyboard and ownership boundaries.
- Expanded directly affected regression run: 10 passed, 7 failed. Six failures were obsolete header/28px assertions, subsequently corrected. New submission test timed out before work.submit; allowing the existing configuration/attachment flow its established 35-second budget resolved it without production changes. Production domain/hover checks and selection/shortcut regressions passed in this run (d0fb8b44-5b68-4318-a946-64870077c40a).
- Corrected focused rerun: 9 passed; artifacts test-results/web-app/39235c6c-1c61-443d-b101-f4133401ad2d/report/index.html. Includes actual Runner-tab send through production frontend orchestration, unchanged UUID/native-session set/terminal output, old-domain placement before confirmed start, then movement and normal draft clearing; domain-local add, failed launch, directory interactions and English/Korean Light/Black dimensions.
- Added restored/provisional context contract: 1 passed (35676fd2-1542-4909-83ed-a219096f5a58). Added unstarted-tab toggle/reload browser flow: 1 passed (e741f37a-75e3-4a37-8d3d-f28509334989); no fabricated history, false zero process count, draft loss during toggles or session closure.
- Visually inspected navigation-en-light and navigation-en-black PNG attachments in d0fb8b44-5b68-4318-a946-64870077c40a/report: full-width pale/dark green buttons, centered plus, per-domain placement and right-aligned management. Browser CSS checks also cover hover colors and 48px height.
- Native-host observation: UNVERIFIED. Tauri readiness inspection found the checkout CLI unprepared (ready=false, preparable=true); no isolated native Runner/WebView visual fixture was exercised. Chromium tests use authenticated synthetic native responses and do not prove installed-Runner or native WebView appearance/process execution.
- git diff --check passed. All nine changed tracked files retain LF/no-BOM state, decode as UTF-8 without replacement characters, and preserve existing Korean text/comments. No report-validation or Runner-owned completion commands run.

## 5. User Verification Message
- Navigation repairs and restored per-domain buttons are supported by focused browser/contract tests and inspected Light/Black screenshots. Existing tabs remain reachable without work history, and confirmed starts move the same session. Native WebView visual parity and installed-Runner execution remain unverified.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"112","task_workload_id":"ce2ff1a852b24f5e85015aff3b4a44f9"}
<!-- TASK_END_RUNTIME_METADATA_END -->
