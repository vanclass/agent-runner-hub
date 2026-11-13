# IssueRun Candidate Report

## Task Info
- Task Number: 148
- Task Title: Preserve independent work observation after discovery becomes unavailable
- Task Title (KR): 모드 확장 호환성과 등록 역할 실행 연결
- Summary: Repaired retained work polling and Refresh admission, and verified independent observation through completion under missing list/status capabilities.
- Summary (KR): 목록이나 상태 조회 기능이 없어도 지원되는 작업 관측으로 진행과 완료를 확인하고 새로 고칠 수 있도록 수정했으며, 관련 브라우저 회귀 검증을 통과했다.

## Work
- Plan: Keep read selection in RunnerWork; use the supported read and its retained identity for polling and Refresh. Extend the existing browser fixture with terminal/API tracking, correlation and no-replay assertions. Preserve the predecessor implementation and report.
- Implemented one read-selection predicate in RunnerWork for polling, refresh execution and Refresh availability. Retained observation identity permits work.observe independently of list/status; original submission identity permits the supported work.status fallback. Existing request, generation and no-overlap guards remain authoritative.
- RunnerWork remains the observation/state owner; RunnerWorkStatus consumes its read-only availability. This necessary presentation query replaces the duplicated UI gate without another state model, scheduler, registry or transport seam. No lifecycle, persistence, editing or role/result representation changed.
- Addressed F01 and F02 from review a7883ba0d1e59186cff646571a125c1914b7bea197ea6ab4fbb6cafc10af70b2: terminal Refresh issues a correlated observe after list rejection; API observation completes with missing/rejected list and missing status, without resubmission.
- Specification decision: no specification impact. docs/implementation_specs/runner_terminals.md already specifies independent observation and exact-submission fallback; its root index still routes to the changed RunnerWork, RunnerWorkStatus and work-discovery tests. The implementation now satisfies that preserved description. The frozen exact Project policy index is absent.

## Validation
- npm run build passed (TypeScript and Vite); Vite retained its non-blocking bundle-size advisory.
- Focused work-discovery, work and mode-compatibility browser batch: 51 passed. This includes the three behavioral regressions, mixed unknown modes/presentation, identity/schema rejection, original-submission fallback, generation fencing, no-overlap and no-replay.
- Focused registered-role/result and interaction replay UI batch: 6 passed. The production composer delivered one exact instruction, observed its start and rendered the canonical subagent result under the existing synthetic native transport.
- Reused the retained predecessor's installed-Runner native success and Rust protocol evidence: the native backend, role-selection/result contract and native fixtures are unchanged. No new native run is claimed. Current browser checks refresh the affected frontend consumers; the predecessor report and diagnostic bytes remain read-only.
- Early targeted runs had fixture-only failures: React resource discovery after the fake clock, then an unrelated initial connection dialog intercepting the component click. The fixture now captures already-loaded resources before installing the clock and closes that unrelated dialog. Final behavioral checks passed without weakening their assertions.
- Verified localized diffs, LF/no-BOM preservation, untouched non-ASCII bytes and protected report identity/title/number. No Korean source comment changed. Finalized browser reports and validation observations are immutable invocation diagnostics.

## Review
- The targeted implementation and coverage findings are resolved; R04/R05 and assigned WG01 obligations retain supported completion with refreshed frontend evidence and applicable retained native evidence. No planning reconsideration is requested.
- Runner owns independent Review, Candidate admission and commit/publication. Changes remain uncommitted at the bound source HEAD; this report makes no publication or whole-IssueRun completion claim.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-82","work_group_id":"WG01","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
