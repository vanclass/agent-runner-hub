# IssueRun Candidate Report

## Task Info
- Task Number: 148
- Task Title: Preserve independent Brief and Run delivery
- Task Title (KR): 모드 확장 호환성과 등록 역할 실행 연결
- Summary: Correct both composers so confirmed Brief/Run delivery remains usable without work.submit, while ordinary Send still requires it. Preserve earlier Work observation and partial-Run capability corrections.
- Summary (KR): work.submit이 없어도 두 입력 화면에서 Brief/Run을 사용할 수 있도록 수정하고 일반 전송의 기능 검증과 기존 관측·재전송 방지 동작을 유지했습니다.

## Work
- Scope: WG01 generation 4, targeted correction of review 29807078 F05/F06 while retaining a7883ba0 F01/F02 and 9de1a866 F03/F04. The approved requirements, Target and Runner-owned role/lifecycle contracts remain unchanged.
- Approach: make eligibility specific to the existing delivery callback; extend the existing native-transport fixture and composer cases; verify retained correction paths and source integrity.
- Changes: runnerSubmission requires work.submit only for ordinary work delivery; SingleEntry applies the same distinction. Existing configuration, unsettled-work, identity, attachment and confirmed-start/replay guards remain canonical.
- Coverage: both Single Entry and Runner tab, with/without Brief, using Work read operations without work.submit. Tests observe pending drafts, correlated initiation, committed-start release, one invocation, optional staging, unavailable ordinary Send and no PTY fallback.
- Architecture: retained the existing procedural configuration/delivery pipeline and RunnerBrief state owner. No new owner, mutable state, representation, callback or compatibility wrapper was introduced; all editing/history/persistence boundaries are unaffected.
- Specification decision: updated the existing Independent Brief staging and Run section in docs/implementation_specs/runner_terminals.md. Existing root-index source/test routes remain accurate; navigation contracts are unchanged. The exact frozen AgentRunnerHub project policy index is absent.

## Validation
- npm run build: passed TypeScript and Vite compilation; existing bundle-size advisory retained.
- Current-Candidate headless Chromium: 4 missing-work.submit composer cases passed; 68 Work/mode/navigation/Brief-owner cases passed; 21 composer and registered-role/result regressions passed. Exact reports are retained as missing-submit.html, work-modes.html and composer-regression.html in this invocation.
- Retained findings: F01/F02 observe-only tracking/Refresh and identity/no-overlap cases pass; F03/F04 partial-Run preflight and unrelated ordinary-send cases pass; F05/F06 Run without Work submission passes for both composers and both input combinations.
- Development attempt: the first four new cases reached committed start but failed the final Send assertion because selection readiness and the tab alert selector were not accounted for. Corrected test sequencing/selectors; the 4-case rerun passed. Retained development-failure.html records the original failures.
- Actual-host evidence: reused the immutable predecessor installed-Runner subagent result and native Work/Run/interaction logs. All source conditions of the retained R04 observation remain byte-identical; the current helper changes only Brief/Run eligibility and preserves ordinary subagent submission. Current UI regression checks selection, delivered input, start and rendered canonical result. No new native/Provider run or macOS acceptance is claimed.
- Integrity: git diff --check passed; existing LF, no-BOM encoding, untouched bytes and Korean comments were preserved. Candidate identity footer remains byte-for-byte unchanged. Current source HEAD and branch remain unchanged; no commit or publication was performed.

## Review
- R04 and R05 assigned obligations are implemented with applicable product observations. The result retains all three review identities and independent evidence for each finding occurrence; no remaining in-scope blocker was observed.
- Reverse contract check: authentication, configuration, exact identity, attachments, unfinished-work ownership, confirmed-start release and unsafe-replay protection remain with their existing owners. Unknown modes are not executable support. Specification and source/test lookup routes agree with the bounded change.
- Ready for Runner-owned Candidate admission and independent Revision Review. This report does not claim acceptance, publication, downstream Work Group completion or whole-IssueRun completion.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-82","work_group_id":"WG01","generation":4}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
