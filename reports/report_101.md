# Session Report

## 1. Task Info
- Task Number: 101
- Task Title: Preserve historical Hub selection initialization intent
- Task Title (KR): Hub 과거 선택의 초기화 의도 보존
- Summary: Close WG11 saved-account projection gap without granting retired labels account authority.
- Summary (KR): 폐기된 계정 레이블에 권한을 부여하지 않고 WG11 저장 선택 초기화 결함을 수정한다.

## 2. Work Plan
- Reproduce historical account labels with allocation/root fields through preferences and authenticated selection fixtures.
- Preserve initialized intent in memory using the existing marker; retain exact identities and current initialization semantics.
- Update the affected specification and run focused browser preference/selection regressions.

## 3. Work Summary
- Updated only the preference projection boundary: historical account labels retain the existing in-memory initialized marker when allocationPolicy/root are the only surviving fields. Labels remain absent from active defaults and persisted explicit edits; no migration schema, writer or Hub selection behavior changed.
- Expanded authenticated browser fixtures across 12 historical label/field combinations for Single Entry and independent per-tab selections, including explicit exact-account saves and configured-submission conversion. Updated the directly owned Hub preference specification.
- No project policy index was present at the canonical AgentRunnerHub policy location.

## 4. Validation Evidence
- Initial projection dropped account and retained allocationPolicy alone, leaving HubSelections eligible for initialization. Account-only records already retained intent; root-bearing restored records already blocked initialization through restoredDefaults. Baseline expanded tests failed 9/12 (including missing-marker assertions and an asynchronous catalog observation failure).
- Corrected historical cases: 12/12 passed; projected initialized intent, zero initialization save callbacks, no desired account, exact original storage bytes, independent tab choices, and explicit authenticated exact-account save/conversion verified. Artifact: test-results/web-app/44f1547c-5521-491c-8d7e-06e2f7a5363a.
- Focused preference/selection regression run: 42 unchanged tests passed; the 12 new tests initially failed due to observing the explicit account refresh before completion. After correcting that test wait, all 12 passed in the focused rerun above. Malformed/unreadable preferences, concurrent writes, exact and partial restoration, mixed historical/current selections, and default initialization passed among those 42 tests.
- Current allocation-only and root-only non-execution drafts: 2/2 passed, retaining automatic initialization and the explicit draft field. Artifact: test-results/web-app/f8fc5907-1599-4389-8381-200e5fab2792.
- npx tsc --noEmit and git diff --check passed. Source/test/spec edits retain LF boundaries with localized diffs. Installed locked npm dependencies after the initial missing-playwright prerequisite failure. No Runner completion gates executed.

## 5. User Verification Message
- Historical labels cannot silently select or persist replacement accounts; explicit exact-account selection remains functional. Focused browser checks and TypeScript verification passed; no manual action required.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"101","task_workload_id":"739814151d524181adcbc0e9e9cc486f"}
<!-- TASK_END_RUNTIME_METADATA_END -->
