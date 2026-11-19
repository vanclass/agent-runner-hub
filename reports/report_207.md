# Session Report

## 1. Task Info
- Task Number: 207
- Task Title: Preserve TaskRun field-first instruction bodies
- Task Title (KR): TaskRun 필드로 시작하는 지시문 본문 보존
- Summary: Repair generated Target metadata boundaries while preserving original instruction bytes and existing submission ownership.
- Summary (KR): 원본 지시문과 제출 소유권을 보존하며 생성된 Target 메타데이터 경계를 수정한다.

## 2. Work Plan
- Inspect shared preparation and canonical Runner parsing; add a non-field boundary only for field-first bodies. Extend focused preparation and both entry-point regressions, compare with the available Runner parser, and run focused tests plus the production build. Preserve explicit Target handling, configuration exclusion, exactly-once submission and original drafts.

## 3. Work Summary
- Added a generated Goal boundary for Target-free instructions whose first nonblank line contains a colon. Original text is appended unchanged; heading-first preparation and explicit Target handling retain existing behavior. No Runner grammar, configuration mapping, Reasoning selection or other Run Mode changed.
- Extended field-first preparation coverage and both UI entry points, including original-draft retention on rejection/uncertainty and exactly-once submission. Existing specification updated: docs/implementation_specs/runner_terminals.md describes the boundary and parser-check prerequisites; existing index routes remain valid.

## 4. Validation Evidence
- npm ci --no-audit --no-fund restored absent local dependencies after initial build/test commands could not find tsc/playwright. npm run build passed (existing bundle-size warning).
- Focused TaskRun and draft-retention browser run: 18 passed; artifacts test-results/web-app/75138ff2-1b37-4ab7-a738-8a4e85def24b. Final focused taskrun-submission run: 3 passed, including 11 canonical Runner parser cases; artifacts test-results/web-app/81c71b69-2335-4e25-bf55-5fca1883568e. Used Runner source D:/Codex/codex_workspace/agent_runner/src and its local/runtime/python-env/Scripts/python.exe. Parser asserted exact UTF-8 body bytes, generated identity and omitted Reasoning.
- Both new field-first UI submission cases passed; artifacts test-results/web-app/cb315e45-b5e2-4942-89e2-aed09439d99e. Shared pipeline assertions verify one submission, no Target/model configuration projection, and existing Goal-first behavior. Rejection/uncertainty tests retained the original field-first drafts without replay.
- git diff --check passed. Changed files decode as UTF-8 without BOM/replacement characters and retain LF. Canonical parser behavior and synthetic Hub submission are verified; actual-provider admission/execution was not performed and remains unverified. No Runner-owned completion gates were run.

## 5. User Verification Message
- The repaired boundary preserves field-first bodies through Hub preparation and canonical Runner parsing. Focused browser tests and the production build pass. Actual-provider execution remains outside the verified evidence.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"207","task_workload_id":"539247601e54467fb928e2b29aeaef33"}
<!-- TASK_END_RUNTIME_METADATA_END -->
