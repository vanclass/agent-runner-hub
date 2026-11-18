# IssueRun Candidate Report

## Task Info
- Task Number: 201
- Task Title: Repair foreground fixture launch and descendant ownership
- Task Title (KR): 허브 네이티브 대화상자 검증 도구 준비
- Summary: Repair FG-01 launch-image isolation and FG-02 startup-to-teardown descendant settlement within the existing test-only fixture.
- Summary (KR): 검증 도구의 실행 파일을 호출별로 분리하고 시작 전부터 자식 프로세스를 추적하도록 수정했습니다. 겹치는 실행과 조기 실패 검증 및 Windows 기본·합성 모드 준비 검증을 통과했습니다.

## Work
- Plan: retain the shared build cache, stage an invocation-owned executable under the build lease, and bind launch to its digest. Assign the root to a Windows Job Object before it runs; use kernel membership for descendant settlement on every exit path. Exercise overlapping handoffs and early failure, then refresh plain/synthetic Windows setup evidence and the native specification. Product acceptance stays with wg-05.
- FG-01: copied and hashed each launch image while holding the existing build lease. The Windows owner locks and verifies its expected digest and reports the created process's image path. Shared-cache replacement no longer changes a retained launch image.
- FG-02: the fixture-local Windows job assigns the suspended root before resuming it. Kernel job membership owns descendant settlement independently of renderer inspection. Unknown launch or unsettled/forced exit preserves the attempt and profile. The former CIM descendant table now supplies inspection evidence only.
- The native automation specification was updated at its existing root-index destination. Test source stays under tests/native/foreground; no production source, managed launcher, WebDriver guard, credential owner or Project configuration changed. Build serialization remains with the existing lease; no concurrency performance claim is made.

## Validation
- Final focused batch: 23 passed, zero failed/skipped. It includes bootstrap isolation/mismatch, actual Windows overlapping launch images and digest rejection, failure before inspection with a surviving child and later grandchild, existing native build isolation and lifecycle checks. See invocation diagnostics/final-focused.log.
- Final Windows plain and synthetic smokes passed separately. Both loaded the Candidate renderer from different invocation-owned executable paths, correlated their WebView profiles, exposed no observed listener, retained ordinary desktop-terminal/native-io features, exited normally with empty jobs and removed their profiles. Only the staged index.html and foreground-boot.js differed from ordinary frontend assets. See diagnostics/final-smoke/plain.json and synthetic.json and final-smoke.log.
- Initial ownership test: launch isolation passed; early-failure cleanup check returned a PowerShell nonzero status after its final absent-process lookup. Explicit successful script exit repaired that test cleanup status; both native ownership cases then passed. The retained temporary attempt was removed only after both recorded descendant PIDs were absent. Earlier plain/synthetic smokes also passed; the final smokes refresh the tightened cleanup predicate.
- Local source review and git diff --check passed. Existing files retain LF without BOM; untouched source bytes and the report's protected identity/footer and Korean title remain preserved. The exact report is not ignored. The verified Workspace Project policy index is absent for AgentRunnerHub; no Project policy or new specification was fabricated.

## Review
- Both retained findings from review 0cd38c5a59e9bac658a496feb70420184b68b77bef719e1d6ea4451842b6ea38 are addressed at their original boundaries. Independent Revision Review and Runner-owned staging/commit/publication remain required. No original requirement ID is completed by this fixture-only Work Group.
- Inherited question: Does a shared backdrop interaction work in the desktop WebView for eligible dialog owners while preserving their distinct behavior? Retained wg-02 Chromium and scripted WebView evidence covers its recorded close/interior-origin/setup paths only; native Escape, wheel and captured-pan results on the final product Candidate remain with wg-05. This smoke issues no desktop input and establishes no product dismissal, OS focus or genuine generated-output claim. No user action is required for this fixture handoff.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-102","work_group_id":"wg-04","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
