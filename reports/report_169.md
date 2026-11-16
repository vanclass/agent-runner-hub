# Session Report

## 1. Task Info
- Task Number: 169
- Task Title: Distinguish pending Runner capability discovery from unsupported inspection
- Task Title (KR): Runner 기능 확인 대기와 미지원 상태 구분
- Summary: Gate unsupported selection guidance on authenticated readiness evidence while preserving configuration failures and transient activity.
- Summary (KR): 인증된 준비 상태를 기준으로 미지원 안내를 표시하고 설정 오류 및 일시적 활동 표시를 보존한다.

## 2. Work Plan
- Trace native readiness publication through RunnerConfigService and HubSelections; preserve configuration request, selection, and footer contracts.
- Expose authoritative unsupported evidence through the existing service and clear only obsolete unsupported guidance.
- Extend focused discovery/activity tests, update the session configuration specification, and run focused browser and safely available isolated Windows validation.

## 3. Work Summary
- RunnerConfigService now distinguishes authenticated ready evidence of unsupported inspection from discovery still in progress, and notifies consumers when that evidence changes.
- HubSelections gates localized unsupported guidance on that evidence and clears only obsolete unsupported guidance; unresolved failures and explicit selection requirements retain their existing behavior. No configuration requests, footer layout, execution contracts, or persistent event logging changed.
- Added discovery/support/failure, obsolete-guidance, and native startup activity observations. Corrected an existing unbound-startup test assertion to match the preserved implementation: retain verified candidates but do not save partial defaults before Target selection.
- Existing specification updated: docs/implementation_specs/runner_session_config.md owns capability/readiness and selection activity behavior. No index change was needed. The exact Workspace project policy index was absent at .codex/docs/WORKSPACE/projects/AgentRunnerHub/docs/PROJECT_POLICY_INDEX.md.

## 4. Validation Evidence
- npm run build: passed TypeScript and Vite compilation (existing large-chunk advisory).
- Focused browser configuration/selection/activity suite: 75 passed. Artifacts: test-results/web-app/2dad82ad-fc8a-421b-9191-b4a297b65fc7/report/index.html. An earlier run had 73 passes and one stale unbound-account assertion failure; the corrected assertion follows the unchanged choose-Target branch rather than changing default initialization.
- Follow-up focused browser discovery, obsolete guidance, unbound startup, pending edit, spare promotion, and independent tab catalog checks: 8 passed. Artifacts: test-results/web-app/3a62b9bc-111c-4b24-a0a6-8ba0c08bdd09/report/index.html. Synthetic browser evidence is separate from native acceptance.
- git diff --check passed; changed files retain LF and no BOM or replacement-character corruption.
- Actual Windows acceptance: HUB_ACTIVITY_RUNNER_ROOT=D:/Codex/codex_workspace node --test tests/native/activity.test.mjs passed all three activity cases (1280, 1000, 780) and the environment test. Each fresh owned Hub process used the installed authenticated Runner; recorded startup activity progressed from option loading to choose-Target guidance with no unsupported message observed. Single Entry/Runner-tab roundtrips retained readable, fixed 22px footers. All fixture resources were released without activation. Evidence: temp/native-probe/7f530b51-c592-43fe-969f-c717efc1ebc7/activity-{1280,1000,780}/evidence.json.
- Observation limits: actual startup was unbound, so choose-Target guidance correctly remained; successful message clearing, genuine unsupported and inspection-failure cases were verified through synthetic browser transport. No native configuration apply or work submission was exercised; those preserved contracts are covered by focused browser checks. macOS and focus-required native input remain unverified.

## 5. User Verification Message
- Implemented and verified: neutral initial discovery, accurate transient loading, preserved unsupported/failure/action guidance, independent selections and unchanged configuration requests. Actual Windows startup showed no unsupported message across three widths; the existing 22px footer and owned cleanup passed. Successful completion clearing and failure/unsupported distinctions passed simulated browser checks; native apply/work and macOS were not exercised.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"169","task_workload_id":"8c9e9ab645864818b1534cfa9c82def9"}
<!-- TASK_END_RUNTIME_METADATA_END -->
