# IssueRun Candidate Report

## Task Info
- Task Number: 201
- Task Title: Bind foreground fixture verification to the reconciled candidate
- Task Title (KR): 허브 네이티브 대화상자 검증 도구 준비
- Summary: Bind staged renderer inputs to the expected candidate revision and refresh both no-input Windows setup observations.
- Summary (KR): 예상 후보 리비전에 렌더러 입력을 연결하고 Windows 무입력 시작 검증을 갱신합니다.

## Work
- Plan: require explicit checkout/revision identity, verify effective frontend bytes before and after staging, retain exact process/asset evidence, and rerun focused ownership and plain/synthetic setup checks. Preserve product acceptance ownership with wg-05.
- Completed: the smoke requires an explicit checkout and expected revision. A test-owned source module checks actual frontend/public/configuration bytes against Git objects before and after the build and retains their SHA-256 inventory with each mode's asset and executable evidence.
- Correction coverage: FG-03 refreshes verification on reconciled revision 1e6a55984c90926d65945db5b9879ffceeba750d. FG-01 invocation-owned launch images and FG-02 pre-resume process-job ownership remain intact and their native regressions passed.
- Specification decision: updated the existing Windows foreground fixture section in docs/implementation_specs/native_automation.md for the explicit selectors, source identity contract and representative source test. The existing index route remains accurate. The frozen AgentRunnerHub project policy index was absent; no project-specific policy was loaded.

## Validation
- Seven focused checks passed: bootstrap transport scoping, corrupted-image failure, plain transport, isolated environment, overlapping launch-image identity, pre-inspect/late-descendant preservation, and checkout/revision/input identity. Seven existing build/lifecycle safeguard selectors also passed.
- Separate plain and synthetic Windows smokes passed on the reconciled revision. Both recorded the same 68 frontend inputs, expected renderer readiness, distinct invocation-owned executable hashes, correlated isolated WebView profiles, no listener, normal root exit, empty process job and removed attempt directories. No native input was issued.
- A deliberately wrong revision produced blocked build-stage results in both modes before process creation, with the exact revision-mismatch reason and removed attempt directories. Retained diagnostics are bound in the invocation's worker result.
- Validation scope: compilation and ordinary-feature Windows setup only. No full suite, genuine image generation or final R04 native gesture acceptance is claimed.

## Review
- Independent Revision Review remains required. All assigned fixture obligations are complete; no product requirement completion is claimed.
- Inherited question: Does a shared backdrop interaction work in the desktop WebView for eligible dialog owners while preserving their distinct behavior? Retained Chromium and scripted-WebView observations support their exercised paths, including both image callers and protected setup/interior interactions. Trusted final-Candidate Escape, wheel and captured-pan acceptance remains outstanding for its sole owner, wg-05.
- Runner owns staging, commit, review disposition and publication. This candidate is left uncommitted at its original source revision.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-102","work_group_id":"wg-04","generation":3}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
