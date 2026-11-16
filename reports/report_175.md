# IssueRun Candidate Report

## Task Info
- Task Number: 175
- Task Title: Shared instruction focus outline
- Task Title (KR): 공유 지시문 입력 포커스 테두리 수정
- Summary: Remove only the instruction textarea focus outline and verify both shared composers.
- Summary (KR): 공유 지시문 입력란의 포커스 테두리만 제거하고 편집 및 키보드 동작을 검증했다.

## Work
- Plan: add a scoped instruction focus override in hub.css; preserve drop-hover and unrelated focus styles. Run the supported build and focused composer checks, then obtain Candidate native presentation evidence. Follow the specification index's direct shell/source/test route; update prose only if a documented claim changes.
- Implemented the scoped `.hub .composer textarea[data-instruction]:focus` override. General focus-visible styling, native drop-active feedback, handlers, layout, and localization are unchanged.
- Extended existing composer tests for pointer/keyboard focus, selection/deletion and multiline editing on Runner and Single Entry. Extended the existing owned native configuration case to inspect both real instruction surfaces.
- Repaired the focused attachment test's start observation: its transport rejects `hub_log`, so it now checks the canonical fixture work's positive started event instead of an unavailable log projection. Attachment order, session identity and removal assertions remain intact.
- Specification decision: direct source/test route sufficient. `docs/implementation_specs/IMPLEMENTATION_SPEC_INDEX.md` routes shell styling to `src/hub/hub.css`; this source-obvious override creates no new responsibility or non-obvious contract requiring feature prose. No specification or translation claim changed. Exact Target policy index is absent in the frozen Workspace context.

## Validation
- `npm run build`: passed (TypeScript and Vite). Existing bundle-size warning retained.
- Final focused E2E: 13 passed, using the supported checkout-local fixture. Includes both composers' Enter/composition guards, text/image paste, attachments and no-outline focus. Run `d65ba78c-d795-4b35-89b2-cdcaefddd625`.
- Earlier E2E: 15 passed / 2 failed. New test refocused the textarea before Tab; corrected to page keyboard traversal. Attachment test awaited unsupported fixture Hub log; corrected to observed work start. Intermediate focused run: 7 passed. All original aggregates retained in invocation diagnostics.
- LF, no BOM and unchanged Korean comment bytes verified on all modified source/test files; `git diff --check` passed.
- Native Candidate: `node tools/native-probe/hub.mjs --case configuration-selection --runner-root D:/Codex/codex_workspace` passed (2 tests). Both displayed Single Entry and Runner inputs were enabled, focused, visible and computed `outline: none`; the retained screenshot shows the Runner instruction surface. Final native run `95d5227c-88fc-4037-ba34-9062c1544731` used a fresh owned profile and ordinary installed Runner, with no desktop activation, no work submission and clean process/listener/profile settlement.
- Initial native attempt failed before focus assertions because its existing settings selectors targeted retired `.context-settings`; repaired them to current `.task-panel`. An intermediate native pass observed focus before display; final coverage additionally checks both surfaces after verified nonactivating display. Retain all three outcomes without promoting offscreen observations to displayed acceptance.
- R09 question-0 applicability: baseline diagnosis and original Hub2 image remain valid context. No historical R09 host completion was reused. Fresh build, final focused browser tests and displayed native observations establish this Candidate's allocated claims. Unchanged preview logic, unrelated physical drag and genuine image requirements remain outside this Work Group.

## Review
- R09 and all allocated WG02 obligations are implemented and verified. Reverse contract review found only the authorized focus styling delta and necessary focused test repairs; other focus and drop-hover rules retain their original bytes. No specification promotion, localization change or planning reconsideration is needed.
- Independent Revision Review, Candidate admission, staging, commit, integration and publication remain Runner-owned. This unpublished Work Group result makes no whole-IssueRun completion claim.
- User verification: no user-only action is required for the assigned validation. The instruction composers retain their normal input behavior with the requested outline removed.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-95","work_group_id":"WG02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
