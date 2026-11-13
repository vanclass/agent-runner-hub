# IssueRun Candidate Report

## Task Info
- Task Number: 148
- Task Title: Preserve independent work when confirmed Run support is unavailable
- Task Title (KR): 모드 확장 호환성과 등록 역할 실행 연결
- Summary: Repair partial Run-capability preflight and operation-scoped receipts; retain prior work-observation corrections.
- Summary (KR): Run 기능 일부가 없을 때 사전 확인과 작업별 수신 검증을 수정하고 기존 작업 관측 수정을 보존한다.

## Work
- Plan: Require invoke and status for confirmed Run before staging/invocation; keep receipt checks scoped to identity and operation. Extend existing Brief owner/composer fixtures and verify no replay plus continued ordinary sending. Recheck retained F01/F02 coverage and update the owning specification.
- Completed: RunnerBrief checks both Run operations before effects, validates each receipt independently of unrelated capability advertisements, and preserves committed staging/no-replay when support disappears. Known pre-invocation unavailability no longer creates false uncertainty.
- F03/F04: Extended the existing RunFixture and Brief owner/composer cases for invoke-only/status-only capabilities, with and without Brief text. Both entry paths retain drafts and issue no staging/Run requests; the original Runner remains configurable and accepts ordinary work. Single Entry uses its existing explicit unsent-assignment release.
- F01/F02: Retained the predecessor scheduler/Refresh corrections and reran terminal/API observation cases without list/status, including correlated completion and no resubmission.
- Architecture: RunnerBrief remains the single ordered request/receipt owner with its narrow port; existing RunnerControl configuration/work owners and composer draft ownership remain intact. No extraction, duplicate lifecycle state or representation conversion was needed. Receipt identity and operation remain distinct from action eligibility.
- Specification decision: Updated the existing Independent Brief staging and Run section in docs/implementation_specs/runner_terminals.md. Existing index/source/test routes remain accurate. The frozen Workspace Project-policy index for AgentRunnerHub is absent.

## Validation
- npm run build: passed (TypeScript and Vite; existing chunk-size advisory).
- Headless Chromium: 61 Work/discovery/mode/Brief-owner cases, 8 partial-capability composer cases, and 5 successful Run/invalid-result/registered-role cases passed. Immutable reports are retained in this invocation's output artifacts.
- Earlier test-development runs failed on insufficient configuration waits, the existing unsent-assignment release, and an incorrect assumption that Single Entry reused the original Runner. Tests now exercise release and explicitly return to that Runner; all final cases pass. Production behavior was not changed for those fixture assumptions.
- Native role/result evidence is reused from the digest-bound predecessor diagnostic after relevant-source applicability checks; no new native execution or macOS acceptance is claimed. Current headless role selection/input/result regression passed. Unchanged native Work/Run protocol test evidence remains historical.
- git diff --check passed; changed files retain LF, no BOM, intact Unicode and unchanged unrelated bytes. Report identity/footer and earlier reports remain untouched. Source HEAD remains 066a3fd5cbb837fc45b9212944a42517bd620a0c; changes are uncommitted for Runner.

## Review
- R04 and R05 are supported by current focused observations plus applicable retained native evidence. Both retained review occurrences (F01/F02 and F03/F04) are addressed within the unchanged approved scope. No blocking obligations or planning reconsideration remain; independent Revision Review and Runner admission/SCM remain required. This report does not claim publication or whole-IssueRun completion.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-82","work_group_id":"WG01","generation":3}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
