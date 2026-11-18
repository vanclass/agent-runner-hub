# IssueRun Candidate Report

## Task Info
- Task Number: 201
- Task Title: Isolated foreground Tauri validation fixture
- Task Title (KR): 허브 네이티브 대화상자 검증 도구 준비
- Summary: Prepare a reusable Windows ordinary-graph fixture and bounded synthetic image bootstrap; validate setup independently of product gestures.
- Summary (KR): Windows 일반 기능 구성의 격리 검증 도구와 합성 이미지 초기화를 준비하고 제품 입력 동작과 구분하여 준비 상태를 검증한다.

## Work
- Plan: reuse managed build ownership and staging; package only invocation-local bootstrap assets, retain an exact Windows process handle, and test plain/synthetic readiness before handing the fixture to its consumer.
- Added tests/native/foreground with a reusable creation/close API, ordinary staged build, bounded GIF list/read bootstrap, Windows handle owner, setup smoke and focused tests.
- Preserved production sources, default launch, application identifiers, real installation verification, Runner authentication and native WebDriver guards. Only the staged index and added bootstrap differ from ordinary frontend assets.
- Used a procedural setup/teardown owner with explicit build, process, renderer, presentation and settlement boundaries. The image payload is the single fixture source of truth; fetch/postMessage intercept only its list/read operations. A new production command, debug listener or alternate application view was unnecessary.
- Existing specification updated: docs/implementation_specs/native_automation.md now identifies the entry and its distinct setup, WebDriver and host-input boundaries. The existing native automation index route remains accurate. No project policy index exists in the frozen exact-Target policy environment.
- Inherited question: Does a shared backdrop interaction work in the desktop WebView for eligible dialog owners while preserving their distinct behavior?
- Scoped assessment: retained Chromium results cover backdrop/Escape, focus return, zoom and captured pan; retained native results cover scripted close paths, interior-origin gestures, setup and separate dialog owners. Their frozen applicability on this admitted baseline is false. Native Escape, wheel and captured pan ending outside were not established by those native probes. This group does not repeat those attempts or claim final-Candidate product behavior; wg-05 owns that observation.

## Validation
- Passed 26 focused bootstrap, build-boundary, environment, lifecycle and platform-selection checks. A corrupted synthetic image produced a setup failure instead of readiness; unrelated IPC remained forwarded.
- Windows plain and synthetic setup smokes passed independently on final fixture source. Both TypeScript/Vite and ordinary Tauri debug builds passed with desktop-terminal/native-io and without native-webdriver.
- Final owned root PIDs: plain 4924; synthetic identity and full results are retained in diagnostics/final-smoke/synthetic.json under this Worker invocation. Evidence includes creation time, HWND, executable and asset hashes, runtime versions and isolated roots.
- Both final cases observed packaged tauri.localhost renderer readiness, visible/enabled native windows without the no-activation style, exact WebView profile correlation and no owned listener. Presentation used the owned HWND at the rear of the primary monitor; no desktop input was issued.
- Both roots exited normally with no forced termination, observed children settled and invocation profiles/staging were removed. The initial narrower smokes and their probe-time source snapshots are also retained.
- Verified only index.html and foreground-boot.js differ in staged assets; ordinary JS/CSS hashes remain unchanged. Production/default/WebDriver source and registration are unchanged. UTF-8 no-BOM, LF, localized document-byte preservation and git diff checks passed.
- Immutable evidence: diagnostics/final-focused-tests.log, diagnostics/final-smoke.log and diagnostics/final-smoke/{plain,synthetic}.json in this invocation. No TestRun suite or product acceptance is implied.

## Review
- All assigned fixture obligations are complete; no original product requirement ID is completed by this group. Runner retains Candidate validation, local commit, independent Review and publication. The successor reconstructs its own fixture/process and supplies its own authorized native-input evidence.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-102","work_group_id":"wg-04","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
