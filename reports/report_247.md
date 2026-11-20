# IssueRun Candidate Report

## Task Info
- Task Number: 247
- Task Title: Windows Explorer Verification Debt and Authenticated Preflight Evidence
- Task Title (KR): 윈도우 탐색기 첨부 검증 유예 및 사전 점검 증거 정리
- Summary: Recorded the two deferred Explorer checks and reconciled the historical authenticated preflight and scripted Hub regression evidence.
- Summary (KR): Windows 탐색기 검증 유예 항목 두 건을 기록하고, 이전 Runner 인증 사전 점검과 Hub 자동화 회귀 검증의 적용 범위를 확인했습니다.

## Work
### Plan

Check the approved amendment and predecessor evidence for each destination, scope the historical preflight to its recorded build, compare the retained regression inputs with this Candidate, and audit the report against the assigned observations.

### Result

Reconciled the approved R01 amendment (`8e804bdb8cb841ee85a108a13f5c6b78`) with the settled WG-01 report 245 and its separate Runner and Single Entry Review findings. WG-01 discovery returned no eligible Explorer target, both drag endpoints were bound to one acquired client, and the native debug observer provided no OLE drag source. WG-01 launched no Hub fixture and issued no native input. Its diagnostic records input, presentation, desktop lease and worker settlement.

The Candidate at `4680a41da7a754032367964d7a810cb9ef0e2c19` includes the report-only WG-02 delivery. The source comparison from the WG-01 baseline adds only report 246. This Work Group edits only report 247. No new fixture, GUI session or authenticated request was needed.

## Validation
- **Runner active — unperformed and unverified.** The retained `runner-explorer-gate` and `runner-explorer-acceptance` observations leave this ordinary-use check open. The outstanding observation is a genuine Windows File Explorer drag of a supported image into non-composer Hub content, a correlated native Tauri drop event and original-path thumbnail before submission, exactly one staged copy for the active Runner, and unchanged inactive destination inventories.
- **Single Entry active — unperformed and unverified.** The separate `single-entry-explorer-gate` and `single-entry-explorer-acceptance` observations leave this ordinary-use check open. The outstanding observation is a genuine Windows File Explorer drag of a supported image into non-composer Hub content, a correlated native Tauri drop event and original-path thumbnail before submission, exactly one staged copy for Single Entry, and unchanged inactive inventories including every Runner.
- **Ordinary authenticated Runner preflight — historical pass.** The ir-109 `authenticated-preflight` observation on build `2ecf55b8fe7bedbd187e67468dfc299b97cb9cc5` records programmatic selection of the original `original.png`, one staged attachment, correlated authenticated `references.register` completion, stable reference inventory and successful ordinary configured `work.submit` with release to Idle. The two historical Hub inputs match this Candidate. The subsequent native Observe change records rejection metadata and preserves the accepted branch's reference capability reads. Current-build authenticated execution and Explorer-to-preflight correlation remain unverified.
- **Scripted regression evidence — source-applicable.** Report 223.2 records 16 focused headless Chromium passes. The retained fixture exercised non-composer ingress, active-only staging, file and folder deduplication and inactive-owner isolation. Separately it covered fixed terminal and Hub log content with localized English/Korean feedback, plus clipboard, composer submission and sidebar reorder regressions. The admitted source and fixture inputs match, so no fresh browser suite was needed. The prior unrelated localization-validator failures for unused `hubLog.older` and `hubLog.unsaved` remain recorded in report 223.2.
- Audited the two debt entries against the approved amendment and WG-01's immutable observations. Checked Candidate source hashes, the report scaffold and footer, and the report-only change inventory.

## Review
- Both physical checks remain open as separate, non-blocking verification debt for ordinary product use after completion. No verification credit is claimed for either transfer.
- The scoped evidence and report are ready for independent Revision Review. The current-build authenticated path remains unverified at the scope stated above.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-114","work_group_id":"wg-03","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
