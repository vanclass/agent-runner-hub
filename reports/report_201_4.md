# IssueRun Candidate Report

## Task Info
- Task Number: 201
- Task Title: Bind foreground fixture evidence to reconciled renderer inputs
- Task Title (KR): 허브 네이티브 대화상자 검증 도구 준비
- Summary: Repair the fixture evidence handoff for the reconciled Candidate and retain fresh plain/synthetic Windows setup observations.
- Summary (KR): 통합된 Candidate의 렌더러 입력과 검증 증거를 연결하고 Windows 일반 및 합성 이미지 준비 결과를 기록한다.

## Work
- Plan: Preserve the invocation-owned launch image and kernel job fixes (FG-01/FG-02). Add a source-inventory check at smoke handoff, reject stale frontend inputs (FG-03/FG-04), and provide repeatable no-input validation against the executing checkout. Update the native automation specification after verification.
- Completed: Added foreground evidence-pair verification after settlement and a repeatable validation entry that binds to its executing checkout/revision and records fresh observations. The handoff compares all effective frontend inputs; metadata-only commits can retain matching evidence.
- Correction coverage: FG-01/FG-02 retain their launch-image/job owners and pass the actual Windows overlap and pre-inspect descendant checks. FG-03/FG-04 now have fresh plain/synthetic observations for 3af699b7dde3f81aa280ceb69bb5900542fe3ebb, a stale-pair rejection check and an executable TestRun smoke suite for reconciled validation.
- Specification decision: Updated the existing Windows foreground fixture section in docs/implementation_specs/native_automation.md. The existing root index still selects that owner. Product source, default launch, installation/authentication owners and WebDriver guards remain unchanged.

## Validation
- Focused validation: 26 checks passed, including real Windows launch-image overlap and pre-inspect/late-descendant settlement, frontend revision/input mismatches, bootstrap scope, and existing build/lifecycle safeguards.
- Native setup: Both plain and synthetic modes passed against the reconciled renderer. Source inventory 68e7523e81a329e2d516cb5ec57f90168e1d90b978ea6109d87d2d75eb952cf3 matched before/after build and at handoff. Ordinary assets matched across modes; only index.html and foreground-boot.js differed from the ordinary staged output. Both owned images had exact process/creation identities, no listener, normal root exit, empty jobs and removed profiles. Fresh app profiles were cold; the existing build cache was reused.
- Negative observation: The retained 1e6a5598 pair was rejected at evidence handoff for changed shortcuts.ts and en/ko locale inputs. Earlier passing observations remain historical.
- Repeatable validation: The finalized TestRun manifest executed both foreground-focused and foreground-current-smoke successfully. The latter recorded and verified another fresh pair without rewriting original observations. Final logs/results and replay records were copied byte-for-byte into immutable invocation diagnostics before successful scratch cleanup.
- Evidence: Invocation b5c791be40694261a5a62620c30c9fc9 retains diagnostics/focused.log, diagnostics/smoke/{plain,synthetic,handoff}.json, diagnostics/stale-handoff-rejection.json, diagnostics/replay/, diagnostics/test-run-snapshot/ and diagnostics/inherited-assessment.json. The result envelope publishes their exact file-byte hashes.
- Edit integrity: Existing source/specification edits contain localized insertions only; original bytes and LF endings were preserved. New source is UTF-8 without BOM. No modified source contains Korean comments. git diff --check passed. The frozen AgentRunnerHub policy environment has no project policy index.

## Review
- All assigned fixture obligations are complete for independent Revision Review. No product requirement ID is claimed complete; Runner owns Candidate admission, commit and publication.
- Inherited question: Does a shared backdrop interaction work in the desktop WebView for eligible dialog owners while preserving their distinct behavior?
- The retained Chromium and scripted WebView results support only their original source/fixture conditions. Native Escape, wheel and captured-pan acceptance on the final Candidate remains with wg-05. This no-input setup smoke establishes no product dismissal, OS-focus or genuine generated-output claim. No manual user verification is needed for this fixture handoff.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-102","work_group_id":"wg-04","generation":4}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
