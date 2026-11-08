# IssueRun Candidate Report

## Task Info
- Task Number: 119
- Task Title: Compact Runner controls and upward-growing instructions
- Task Title (KR): 입력 주변 표시 정리와 로그 위로 확장되는 Runner 입력창
- Summary: Remove redundant input controls and reserve three lines while longer Runner drafts overlay the log.
- Summary (KR): 중복 입력 컨트롤을 제거하고 기본 3줄을 확보하며 긴 Runner 초안을 로그 위로 확장한다.

## Work
- Plan: Remove shared picker controls, Runner Send controls and the empty ready/none interaction panel. Keep session-owned drafts, submission guards, native drop/paste, attachment operations and Single Entry assignment intact. Measure textarea presentation inside RunnerComposer; reserve only its base height and overlay extra height. Update directly affected fixtures and current specification, build, run focused browser checks and attempt isolated native WebView validation.
- Implemented: Shared picker/help and Runner Send rows are removed, including disconnected placeholders. Ready/none without meaningful state renders no interaction section; active controls, details, pending input and results retain their owner.
- Model: RunnerComposer measures its native textarea and content container on draft/mount/resize. A fixed base slot anchors an absolute, capped overlay above it. Session draft/submit, reference selection, structured interaction and xterm ownership are preserved. Duplicating draft state, intercepting editing/clipboard operations, changing terminal fit and adding a coordinator/public callback were rejected as unnecessary synchronization surfaces. Framework editing, selection, undo/redo and paste remain native; only presentation measurements are added.
- Updated direct tests to Enter and coordinate-bound native drop; preserved independent Single Entry Assign/release/transfer. Retired unused translations and picker-only rendering state. Added a narrow Vite watcher exclusion after concurrent native compilation caused EBUSY on Cargo output; no launcher/backend changes.
- Specification decision: Updated the existing canonical runner_terminals.md paragraphs for composer overflow, Enter, attachments and none presentation. Existing index/source/test routes remain valid; no new document/index was needed. Workspace Project policy index was verified absent for AgentRunnerHub.

## Validation
- npm run build: passed (final frontend build); existing chunk-size warning remains informational.
- npm run test:i18n: passed after removing task-obsoleted keys from both catalogs.
- Native build: Cargo reported a finished build and the resulting Candidate executable launched in an isolated WebView2 profile. The first PowerShell pipeline returned exit 1 despite the completed-build log; the final pipeline exit was not retained. Preserve those command-result limits. The produced artifact and dedicated native process establish compilation/loadability, not actual WebView behavior acceptance.
- Browser batches: third run 42 passed / 4 failed / 13 not executed at suite timeout; fourth 17 passed / 4 failed; fifth 2 passed / 1 failed; sixth 1 passed / 1 failed. Follow-up checks resolved the late-start fixture (explicit Refresh work status), transient interaction receipt fixture, removed theme surface and restored shortcut readiness. Both 550/800 composer overlay checks, attachment flows, late start, guarded/duplicate Enter, Single Entry independence, interaction responses/results, log search/scroll/tab return and Light/Black responsive checks passed. Earlier failed/interrupted results remain evidence, including the native-build watcher EBUSY.
- Remaining browser failure: session-config-ui's cross-account model-catalog setup reports control not ready and never provides m2, before draft submission. Configuration/catalog owners are unchanged; no input, attachment, terminal, interaction or keyboard protocol was changed to hide it. Scoped success evidence remains separate from this failed broader configuration scenario. Simulated native bridge evidence is not actual WebView acceptance.
- Modified text remains UTF-8 without BOM and LF; git diff --check passed. Existing Korean comments were preserved, and the new top-gap tuning comment was verified readable.

## Review
- Actual WebView prerequisite and final scoped requirement/obligation settlement remain pending. Runner retains independent Review, Candidate commit, integration and publication; this report does not claim those outcomes.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-45","work_group_id":"WG01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
