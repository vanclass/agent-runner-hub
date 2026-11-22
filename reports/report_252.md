# Session Report

## 1. Task Info
- Task Number: 252
- Task Title: Restore Hub integration with the installed Runner Workspace
- Task Title (KR): 설치된 Runner 워크스페이스와 Hub 연동 복구
- Summary: Resolve and verify Runner from the selected Workspace root and exercise the existing Windows Hub session lifecycle.
- Summary (KR): 선택한 워크스페이스 루트에서 Runner 설치를 확인하고 기존 Windows Hub 세션 수명 주기를 검증한다.

## 2. Work Plan
- Trace installation selection and persistence, verified Python launch, and consumers of the selected Runner root.
- Update the Hub resolver, affected profile paths, fixtures, and operational documentation for the canonical Workspace layout.
- Run focused frontend and native checks, then use the existing background Windows test infrastructure to verify Settings, an authenticated read-only interaction, and shutdown of the Hub-owned Runner session.

## 3. Work Summary
- Hub resolves the selected Workspace root using `src/runner/__main__.py` and verifies that managed Python uses the matching `local/runtime/python-env/` and imports the same installation's `src/runner/__init__.py`. The resolver uses the existing platform-specific executable paths.
- Settings and first-run setup retain the existing verification and persistence flow. Both launch and Settings use the same native resolver. The retained backend, Windows interpreter launch, authenticated control, PTY ownership, and shutdown path retain their existing contracts.
- Updated the native test-account home check and affected fixtures to use `local/profiles/codex/accounts/`. Updated English and Korean setup text and the existing terminal and session-configuration specifications. The specification index continues to route to the same owners. AgentRunnerHub has no Workspace project policy index.
- Extended the background native read-only case to close the exact observed PTY and check its removal. Fixed the probe's optional session ID handling at the WebDriver boundary and covered that behavior in its existing fixture test.

## 4. Validation Evidence
- Windows installed Runner acceptance passed using `node tools/native-probe/hub.mjs --case runner-read-only --runner-root <absolute Workspace root>` against `D:/Codex/agent-workspace`. The hidden Hub persisted the verified location in its fresh profile, observed PTY output from its own Runner, and received the correlated authenticated `session_config.inspect` completion for session 0, generation 1, receipt 5. The configuration revision stayed unchanged.
- The native close completed with an empty Windows job and removal of that exact PTY from the registry. The Hub exited normally without forced cleanup or activation, its loopback listener closed, and the fixture released its isolated profile. Evidence is in `temp/native-probe/92de4750-4d06-4e99-830e-7669a96ca536/runner-read-only/evidence.json`.
- The separate background `installation-entry` case passed. A relative path was rejected by the native resolver, setup stayed open for correction, and the Hub saved no path and launched no Runner. Evidence is in `temp/native-probe/d045c376-1fb6-4d35-901e-7350cd57173a/installation-entry/evidence.json`.
- All four pre-existing Runner process identities, including the invoking TaskRun chain, were still present after shutdown. The Workspace tracked files and registered Project registry hash matched their baseline. The existing user Chrome browser process was still running. Validation used isolated WebView2 and headless Chromium profiles.
- Four native resolver tests passed, including the normally installed Python and exact source registration check. Twelve Rust session configuration checks and the `control_handles` integration target passed. Its two subprocess cases used synthetic protocol fixtures and are separate from installed-Runner acceptance.
- All 26 focused Playwright setup and session-configuration tests and nine native probe fixture tests passed. The frontend and Windows native builds passed. `git diff --check` passed.
- The i18n aggregate reported existing unused keys `hubLog.older` and `hubLog.unsaved`. Running the same catalog checker against Git HEAD produced identical diagnostics.
- The first live read-only attempt reached Runner launch and stopped at a WebDriver session-ID serialization defect. The patched probe passed on retry. An overlapping build attempt encountered a transient build-lock generation conflict and produced no live observation.

## 5. User Verification Message
- The existing installed Runner Workspace can be selected and retained in Hub Settings. The Windows background acceptance verified the full read-only session and owned shutdown. No additional host prerequisite was needed for that run. The existing macOS Runner launch restriction still applies.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"252","task_workload_id":"34c52fdae6994c32a6b367008c624718"}
<!-- TASK_END_RUNTIME_METADATA_END -->
