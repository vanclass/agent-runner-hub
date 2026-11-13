# IssueRun Candidate Report

## Task Info
- Task Number: 148
- Task Title: Forward-compatible modes and registered subagent work
- Task Title (KR): 모드 확장 호환성과 등록 역할 실행 연결
- Summary: Implemented subagent work and forward-compatible mode admission; focused checks and the installed-Runner native role-to-result flow passed.
- Summary (KR): subagent 작업과 확장 모드 호환성을 구현했으며 집중 검증과 설치된 Runner의 실제 역할 선택부터 결과 표시까지의 네이티브 검증을 통과했다.

## Work
- Plan: preserve authenticated identity and request correlation while extending existing Work, interaction and navigation owners; verify focused browser/native contracts and the installed Runner path; maintain affected specifications.
- Implemented per-operation Work/Run admission, subagent mode labels and known-mode selection, subagent identity/result projection, validated mixed-mode discovery, and lossless unsupported presentation names with known-tab restoration.
- Runner remains the role, execution and result authority. Hub reuses its existing foreground role selection and Work state machine. Navigation retains presentation only; unknown-mode tabs use the existing Task Run display fallback without executable admission. This extends existing owners rather than adding another registry, workflow or synchronized state model.
- Updated existing runner_terminals.md and runner_navigation.md specifications and root lookup routes. The exact frozen Project policy index was absent. No managed component update was needed.

## Validation
- Frontend build passed. Focused work/discovery/navigation/Brief browser batch: 42 passed. Focused role-selection/result, interaction-replay and navigation UI batch: 4 passed.
- Native Rust protocol checks: Work 13 passed, Run 6 passed, interaction 5 passed. Original identity/correlation/schema rejection and unsafe-replay cases remain active. The ignored Test-account work_acceptance case was not executed; ordinary installed-account validation uses the separate native Hub case.
- Earlier batches exposed obsolete all-operation/four-mode expectations and a synthetic subagent identity mutation. Fixtures were reconciled with the approved contract and stable identity; focused reruns passed. The first native attempt reached authenticated configuration but its hidden-tab test could not observe role selection; the corrected task-owned case is assessed separately below.
- Verified UTF-8 readability, no new BOM, LF preservation, exact unchanged spans and clean diff whitespace. No existing Korean source comment was changed. Referenced diagnostics are finalized and byte-hashed in the invocation result.
- The native case gives model completion its own bounded test budget instead of applying startup readiness timing. Native harness/lifecycle checks passed (16 cases). The encoding detector verified limits.mjs as UTF-8; a one-byte truncate restored its original no-newline EOF after apply_patch added a newline, with every other byte verified unchanged.
- Final installed-Runner native case passed on the current Candidate build: exact AgentRunnerHub target, registered Interpreter selection through Hub, one read-only instruction, observed lifecycle and successful completion, and displayed JSON equal to the canonical accepted result. The background process never activated the desktop; graceful process exit, listener release and profile cleanup passed.
- Probe-only readiness assumptions, a short execution wait and competing status-read interference were corrected without changing production architecture. The final probe reads Hub-owned discovery snapshots. Earlier failed/unverified attempts remain separate immutable diagnostics and are not counted as acceptance.

## Review
- R04 and R05 and every assigned obligation are complete for WG01. No current blocker remains. Review should assess this independently usable capability and its retained fixture/native evidence, without treating this group as whole-IssueRun completion.
- Independent Runner Review remains required. Candidate changes are uncommitted; source HEAD and protected report identity remain unchanged. No publication or whole-IssueRun completion is claimed.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-82","work_group_id":"WG01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
