# Session Report

## 1. Task Info
- Task Number: 140
- Task Title: Migrate Hub managed deployments to canonical project configuration paths
- Task Title (KR): Hub 관리 배포를 표준 프로젝트 구성 경로로 이전
- Summary: Reconcile the existing Web App, Tauri, Desktop and Build System installations through Runner Project Management, update project consumers, and verify behavior and preserved state.
- Summary (KR): Runner Project Management로 기존 Web App, Tauri, Desktop 및 Build System 설치를 조정하고 프로젝트 경로 참조와 보존 상태를 검증한다.

## 2. Work Plan
- Inspect the canonical Component receipts, installed Runner catalog and affected project consumers; preserve Component selections and all behavior outside the path transition.
- Apply the installed Runner's canonical Update/Review/Apply to this task worktree without editing receipts or managed packages manually. If admission, ownership or historical evidence blocks migration, preserve the existing installation and record the exact blocker.
- Update project-owned scripts, native utilities, imports, focused tests and documentation to the successfully deployed paths; keep root launchers, native source and CI under their existing owners.
- Verify receipts and deployed paths, focused build/test/native entries, retained settings/results and repeated Update currency. Distinguish actual runtime evidence from unavailable native-host acceptance.

## 3. Work Summary
- Migration blocked before Apply: the installed Runner rejected canonical Update with `PROJECT_SOURCE_GENERATION_STALE` at `project_catalog` / `resolve_project_source`: "The executing deployment generation differs from the admitted source bytes." No asynchronous request was accepted and no Component reconciliation ran.
- Read-only catalog succeeded for exact Project `AgentRunnerHub` and task worktree `scm/140`. Source/management root: `D:/Codex/codex_workspace`; registered checkout: `D:/Codex/agent-runner-hub`. Catalog receipt: `../workloads/75809ddabf914540bd8ae8a72de6e783/exec_runs/94c0645c1a114c6caa6981f4bd66d5f1/project_operations/b7d2af1761a84b3f8676be1859c25497/result.json`.
- Submitted `runner_project(operation=update, project_id=AgentRunnerHub, baseline_id=0f0844b9190cca8b4a1faf1f4b2681484cac05e54450a526df26d25a16b5a28d)` with existing items `WebApp`, `WebApp/Foundation/ViteVanillaTS`, `WebApp/Frameworks/React`, `WebApp/Runtimes/Tauri2`, `WebApp/Tools/DesktopCI`, `WebApp/Tools/DesktopTerminal`, `WebApp/Tools/TauriNativeIO`, and `WebApp/Tools/WebAppBuildSystem`; no options, removals or Type changes.
- The admitted source, canonical integration and published heads all equal `47dfefecde661c0cc3bc7330e8ff83b5b838ddc1` on `main`. Executing deployment generation reported by catalog: `f618bdf5743170c931aab3f3bea4cb6162007b7c6c0dfe5ba59982ad224e148a`. Workspace deployment source already contains canonical paths, while the running catalog advertises legacy contributions. This is an executing-generation admission failure, not a demonstrated target ownership conflict or native permission denial.
- Preserved the existing installation and all source consumers rather than leave imports pointing to absent deployments. Affected consumers identified: package scripts, `tools/hub-native.mjs`, native-probe build/macOS imports, e2e fixture imports, Desktop CI workflow, native clipboard checkout/cache detection and its focused tests, and native tooling documentation. Managed root launchers, workflows and package contributions must follow their canonical owners when migration resumes.
- Only this active report was edited. No managed file/receipt was manually moved or reconstructed; no fallback, alias, separate migration state, synthetic Runner or independent installation was created. Project policy lookup found no index at the exact Target's Workspace policy root.

## 4. Validation Evidence
- Canonical catalog: SUCCESS. Canonical Update: FAILURE before Apply, `PROJECT_SOURCE_GENERATION_STALE`, `retryable=false`. No successful deployment or operational readiness is claimed.
- Post-rejection inspection: `.project-config/components.json` SHA256 remains `f5a88ce4a0a7a89689129b694f72ae08ba7a914d087a87172d542fc583d15d0d`, exactly matching the pre-Update catalog content digest. Existing desired selections are unchanged. `git status --short` shows only this untracked active report; `git diff --stat` is empty.
- Existing `.runner/web-app-launch`, `.runner/web-app-testing`, `.runner/web-app-tauri`, `.runner/web-app-desktop` and `tools/web_app_build_system` remain. `.project-config/managed` and `.project-config/tools/web_app_build_system` are absent. Legacy retirement would be unsafe before successful reconciliation and integrated validation, so it was not attempted.
- Project-owned `tools/i18n`, `tools/native-probe`, `tools/hub-native.mjs`, `src-tauri` and all six root launch/build entries remain present with no tracked changes. Launch settings, Build System `settings.json`/`.local`, root `local` and `dist` are absent in this task checkout; no preservation claim is made for runtime state not present here. The registered checkout's user settings/data were not modified by this task.
- Frontend build, deployed Build System execution, focused Tauri/native-probe tests, normal native Hub launch/Runner selection and repeat-Update no-op acceptance remain unverified because the migration was not admitted. Running legacy entries would not validate the required final layout. No Runner-owned completion gates, report validator or task-end command was run.

## 5. User Verification Message
- Migration is not complete and is not yet ready for WG3-WG7 acceptance. The existing checkout is preserved. Required next step: have the Runner owner refresh/restart the normally installed Runner after this task settles so its executing deployment generation matches the integrated/published Workspace source, then resume the canonical catalog/Update flow for AgentRunnerHub. Do not terminate the active task Runner, switch source roots, edit receipts, or install a substitute Runner to bypass admission.
- After that environment prerequisite is resolved, rediscover the baseline, reconcile the unchanged Component selections through Update/Review/Apply, update project consumers, verify applied receipts and deployed entry points, run the integrated focused build/test/native checks, and confirm repeat Update is current/no-op before claiming migration success.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"140","task_workload_id":"75809ddabf914540bd8ae8a72de6e783"}
<!-- TASK_END_RUNTIME_METADATA_END -->
