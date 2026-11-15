# IssueRun Candidate Report

## Task Info
- Task Number: 157
- Task Title: Native active Hub activity verification
- Task Title (KR): 허브 액티비티 문구와 입력창 좌단 정렬 개선
- Summary: Repair RR-HUB-001 by observing active localized footer text in isolated native Single Entry and Runner contexts at responsive widths.
- Summary (KR): 독립 네이티브 창에서 활성 한국어 액티비티 문구와 입력창 정렬을 확인하도록 검증 범위를 보완했습니다.

## Work
- Added tests/native/webdriver/activity.mjs and its explicit tests/native/activity.test.mjs composition. Existing installed-Hub, owned-session and read-only inspection helpers establish real prerequisites; UI actions select both contexts without work submission or configuration application.
- Extended the Windows placement adapter with an optional case width. It continues to affect only the created process/owned HWND, behind the foreground window without activation. No production seams or settings-state changes were added.
- The displayed callback checks Korean guidance, sentence/input edges, clipping, polite atomic semantics, reserved line height and context-roundtrip geometry.
- Specification decision: updated docs/implementation_specs/native_automation.md at its existing case boundary. runner_session_config.md and its existing index routes remain accurate; no new specification owner is needed. The exact frozen AgentRunnerHub policy index is absent.

## Validation
- Native displayed observations passed at requested window widths 1280, 1000 and 780 (actual CSS viewports 1266, 986 and 766). Both contexts show the real Korean target-selection guidance; sentence and input left edges agree, text is unclipped, the reserved line is 22px, and a context roundtrip preserves geometry. Captures and measurements are retained in the invocation diagnostics. Every owned process exited normally without activation and released its listener/profile.
- Preserved attempts: the initial fixture incorrectly expected null instead of the actual empty Target string; corrected only that assertion. The subsequent intermediate-width read-only receipt timed out before display and remains unverified. A fresh isolated intermediate-only attempt passed; no uncertain session request was replayed. The earlier mixed native suite remains failed in retained evidence.
- Focused browser checks: 7 passed for activity projection, English/Korean responsive geometry, refusal and owned-flow simulations; 1 passed for exact tab submission, pending-to-verified status and context isolation. These simulated outcomes establish their exercised contracts only; native guidance is not settings-application success.
- Locale checks: 4 passed and catalog integrity passed. Native isolation/platform/lifecycle regression checks: 16 passed. Each native attempt built the actual TypeScript/Vite frontend, the test executable and ordinary native library. The ordinary dependency graph excludes WebDriver. Git diff/UTF-8/no-BOM/LF checks passed.
- Existing product source and truthful result classification are unchanged by this correction. The supported success sentence is exercised by focused browser evidence; no real configuration application or model work was submitted. macOS and trusted physical input are not exercised.

## Review
- RR-HUB-001 from review 4b6cb04e219e9a97947b8b492a79d8b1f039d82d23b7c2df43ec0453b5d8125a is addressed by active native observations instead of an empty setup footer. REQ-HUB-ACTIVITY and the assigned obligations are supported by the combined source-applicable native and focused browser evidence.
- Runner retains Candidate validation, commit, independent Review and publication. This report records this unpublished correction only; predecessor reports/evidence remain unchanged.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-91","work_group_id":"WG-HUB-ACTIVITY","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
