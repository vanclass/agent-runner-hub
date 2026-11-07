# Session Report

## 1. Task Info
- Task Number: 113
- Task Title: WG2 automatic selections and Runner allocation policy
- Task Title (KR): WG2 자동 선택 항목 로딩 및 러너 배정 방식
- Summary: Load authenticated choices automatically, clarify account selection, and extend existing allocation to three policies while preserving WG1 ownership.
- Summary (KR): 인증된 선택 항목을 자동 로딩하고 계정 선택을 명확히 하며 WG1 소유권을 보존하면서 배정 방식을 세 가지로 확장한다.

## 2. Work Plan
- Extend HubSelections readiness-triggered inspection for fresh and restored choices while retaining saved values and in-flight edits; remove manual refresh and startup false warnings.
- Replace the reuse checkbox with a localized persisted three-choice allocation dropdown; filter existing idle candidates by canonical navigation affiliation for same-mode reuse.
- Preserve authenticated account validation, reservation, attachment and confirmed-start owners. Run focused selection, assignment, preference and Light/Black rendered checks; distinguish Chromium evidence from native WebView evidence.

## 3. Work Summary
- Automatically load fresh and restored Hub option catalogs after verified admission/authenticated readiness, once per owner; preserve saved partial/unsupported requests and edits during inspection. Removed refresh controls and ordinary-startup false control warnings while retaining inspection/unsupported diagnostics.
- Added Select an account / 계정 선택 without weakening exact agent/profile verification or unresolved-account rejection. Replaced the reuse checkbox with the exact localized three-choice allocation dropdown, persisted through existing preferences and locked with Single Entry assignment.
- Same-mode reuse filters existing idle candidates using canonical WG1 navigation affiliation after fresh eligibility verification, independent of sidebar display. Retained reservation, configuration, attachment and submission owners; reserve promoted spares before tab binding to prevent automatic inspection races.
- Updated existing hub_preferences.md and runner_terminals.md specifications for changed contracts and focused evidence. No WG3/WG4 recovery behavior changed. Exact Target project-policy index was absent; no project-specific policy was loaded.

## 4. Validation Evidence
- npm run build passed TypeScript/Vite compilation; retained existing bundle-size advisory. npm run test:i18n passed catalog tests and English/Korean key/interpolation checks. git diff --check and UTF-8/BOM/EOL preservation checks passed.
- Selection initialization, selection projection/identity and preference regressions: 64 passed (test-results/web-app/74777cf6-1d88-454a-ab4c-5c77ead495c2/report/index.html). Delayed fresh/restored loading, genuine inspection failures and WG1 navigation regressions: 11 passed (d9026510-19af-4daf-b033-592e31de1765).
- Rendered Light/Black English/Korean policy controls, restart persistence, unresolved-account rejection, assignment lock, fresh/restored catalogs and unrestricted-reuse/always-new production Hub flows: 5 passed (cf03fc03-b44e-4888-ade7-446397b787c5). Inspected attached screenshots for readable labels, placement and account placeholder.
- Final allocation matrix: 10 passed (test-results/web-app/a96c4c25-ebfa-4145-a6e9-0fdc36a8992f/report/index.html), covering all three policies, mixed affiliations, missing/busy same-mode candidates and newly allocated destinations under both sidebar display modes; unused session settings remained unchanged and each assignment submitted once.
- Early test attempts exposed outdated no-startup-inspection/checkbox expectations, candidate-readiness fixture gaps and the promoted-spare reservation race; corrected these and reran affected tests. A source update invalidated an intermediate live-server run; final focused runs use unchanged relevant source.
- Browser/native-bridge fixtures are Chromium evidence only. Actual-host native WebView, real Provider authentication and packaged product acceptance were not exercised and remain unverified. Runner-owned canonical completion gates were not invoked.

## 5. User Verification Message
- Available choices now load automatically. App Settings offers three persisted Runner allocation policies; same-mode reuse excludes differently affiliated idle Runners. Account clears remain explicit and cannot submit configured work. Focused browser evidence is recorded above; native WebView acceptance remains separate.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"113","task_workload_id":"a572d1b3d9d246e6878596da8a8e4e94"}
<!-- TASK_END_RUNTIME_METADATA_END -->
