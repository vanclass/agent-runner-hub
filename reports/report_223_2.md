# IssueRun Candidate Report

## Task Info
- Task Number: 223
- Task Title: Deduplicate paths within Hub file-drop events
- Task Title (KR): Hub 파일 드롭 경로 및 드래그 피드백
- Summary: Corrected both retained R01 findings by deduplicating each Hub drop payload before staging and testing the resulting attachment chips for both destinations.
- Summary (KR): Hub 드롭 이벤트의 중복 경로를 스테이징 전에 제거하고 Runner와 Single Entry의 첨부 항목 및 비활성 대상 격리를 검증했습니다.

## Work
- Applied the approved correction to the existing Hub ingress with an event-local Set. The existing selection remains the sole staging writer; separate drop events retain their existing behavior.
- Added Runner and Single Entry cases with repeated folder and image paths in one event, exact per-path chip counts, inactive-owner checks, selection retention and a later repeated-path event from the composer.
- Addressed R01-duplicate-path and R01-duplicate-path-coverage from review 7d37c9bfe64a6ef9d5a506bc5d36b92213b6fa54aadf9e71f7f04c287f13c725.
- Specification decision: no specification impact. Existing Hub ingress, staging ownership and scripted/native boundaries remain accurate in docs/implementation_specs/runner_terminals.md, native_automation.md and IMPLEMENTATION_SPEC_INDEX.md; the existing hub-file-drop.mjs evidence route now covers the missing invariant.

## Validation
- PASS: npm run build (TypeScript and Vite); existing bundle-size warning retained.
- PASS: 16 focused headless Chromium cases selected from runners.spec.mjs for Hub ingress, both duplicate-payload cases, English/Korean fixed-content viewport and feedback checks, composer attachment/paste/submission regressions and sidebar reorder ownership. Immutable logs and browser evidence are published with this invocation.
- FAILED, unrelated: npm run test:i18n reports unused hubLog.older and hubLog.unsaved. The same catalog validator with the invocation-start hubFileDrop.ts produces identical errors. No attachment locale/interpolation error was found; both locales passed rendered feedback assertions. No unrelated catalog changes were made.
- PASS: localized source diff, unchanged bytes outside the intended edits, LF/no-BOM preservation and git diff --check.
- Physical Windows transfer for Runner: unverified. Single Entry: unverified. Authenticated preflight: independently unverified. This correction supplies scripted bridge evidence; WG-03 retains actual file-manager/native-event/original-path/preflight acceptance.

## Review
- Scoped correction and assigned WG-01 checks complete; R02/R03 have current rendered product observations. R01 whole-product completion is withheld for WG-03's distinct native boundary. Independent Revision Review remains Runner-owned; no commit or publication was performed.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-104","work_group_id":"wg-01","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
