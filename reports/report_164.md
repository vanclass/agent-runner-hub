# IssueRun Candidate Report

## Task Info
- Task Number: 164
- Task Title: Recover local attachment previews and exact resource lifetime coverage
- Task Title (KR): 선택 파일 미리보기와 수명 검증 복구
- Summary: Recovered selected PNG thumbnails, complete native PNG/UTF-8 acquisition and a shared support catalog; verified exact local preview URL lifetimes for both composers without changing submission ownership.
- Summary (KR): 제출 소유권을 유지하면서 선택 PNG 썸네일, 원본 PNG·UTF-8 읽기, 공용 지원 목록을 복구하고 두 입력 경로의 로컬 미리보기 URL 수명을 검증했다.

## Work
- Plan: Recover the retained reader and catalog; integrate with existing native handlers and selection cleanup; exercise exact URL lifetimes for both composers, original-path preflight, PNG identity and complete text acquisition; update only affected specifications.
- Completed: Reused the retained LocalPreviews and native reader/test sources, adapting selection integration to the current session/lease/preflight owners. The selection owns one source-keyed preview map; local URLs are never copied into pasted URL ownership or durable preferences. Generated retrieval/withholding remains with its existing owner.
- Native composition: Added the main-window-only read command to both existing platform handler lists and lib initialization. Blocking reading stays off the UI loop. PNG/base64 dependencies cover both supported desktop platforms. The JSON catalog lives inside the staged native source tree and is imported directly by TypeScript, avoiding duplicate extension lists and staging escapes.
- Model: Retained bounded sequential reads to limit competing decoder/IPC allocation; no measured concurrency speedup is claimed. Selection creation triggers image acquisition, while original text is available on demand through the same reader. Preview failure does not gate original-path registration. Entry identity fences cancelled/disposed reads; existing delivery ownership controls confirmed-success retirement and uncertain retention.
- Coverage: Both real composer flows now assert distinct selected/pasted image bytes and exact URL retirement on cancellation and confirmed delivery, preservation during uncertainty, and exactly-once original-path preflight. Production RunnerSession and RunnerSessions/Single Entry disposal assertions verify exact retirement and late-result fencing. Distinct R01/R02/R04/R06/R07 lifetime results are bound in execution findings.
- Specification decision for R01/R02/R04/R06/R07/R08: Updated the existing attachment owner in docs/implementation_specs/runner_terminals.md and its root index route for local acquisition/catalog/lifetime behavior and focused tests. No duplicate feature narrative was created. The exact frozen Workspace Project policy index was absent; no project-specific policy was substituted.

## Validation
- PASS: npm run build (TypeScript/Vite) on final production sources. Existing bundle-size warning remains advisory.
- PASS: Normal staged native cargo check --locked --offline with desktop-terminal,native-io; the existing platform composition and source-owned catalog build without the native-webdriver feature.
- PASS: Native local_preview::tests::selected_originals_and_failures verifies exact original PNG/path, complete multiline Korean txt/md/json and whitespace, plus invalid UTF-8, binary, missing, directory, unsupported, oversize and truncated-PNG outcomes.
- Browser: All six new local preview cases passed. The focused attachment regression batch recorded 23 passed / 1 failed: its pre-existing preallocation assertion expected obsolete work.started text while the current locale/UI displayed Task started. Corrected only that assertion; its focused rerun passed, including subsequent session/selection isolation checks. The original failure and trace are retained, not relabeled a passing suite.
- Review: Examined rendered selected/pasted thumbnails, scoped source diff and exact native handler preservation. Changed text remains LF and UTF-8 without BOM; Korean original test contents remain intact. git diff --check passed. Report is not ignored. Task helper scratch was removed; immutable logs, complete browser artifacts and source evidence are retained under the Worker invocation diagnostics.

## Review
- WG01 deliverables are complete and ready for independent Review. No whole product requirement is claimed complete: physical external OS drag, genuine generated-image acceptance, focused gestures, label/reorder presentation and Help UI retain their assigned successor owners. This work does not alter IR-92 artifacts or claim its historical checks were rerun here.
- Windows compilation, real filesystem reader tests and headless Chromium with simulated native/Runner transport are separate evidence boundaries. Actual native IPC/display and macOS execution were not newly exercised. Native reader success and simulated callbacks are not physical-transfer or authenticated generated-output evidence.
- Runner owns Candidate staging, commit, Review routing and publication. The source HEAD remains unchanged; no user verification or additional approval is required for this handoff.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-93","work_group_id":"WG01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
