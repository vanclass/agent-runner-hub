# Session Report

## 1. Task Info
- Task Number: 209
- Task Title: Correct Runner sidebar idle projection after task completion
- Task Title (KR): 작업 완료 후 Runner 사이드바 유휴 상태 표시 수정
- Summary: WG5 item 7: distinguish historical Work restrictions from fresh canonical execution activity without changing admission safety.
- Summary (KR): WG5 항목 7: 작업 제출 안전성을 유지하면서 과거 Work 제한과 현재 실행 상태를 구분한다.

## 2. Work Plan
- Trace Work presentation, canonical observation freshness, execution lifecycle, attention and sidebar consumers. Reproduce the historical-attempt masking case in focused tests.
- Correct only the canonical sidebar projection; preserve work admission, reuse, reservation, recovery, references, notifications and terminal history.
- Extend focused Work and sidebar regressions, run the production build, and evaluate the installed native Windows observation path separately from fixtures.

## 3. Work Summary
- Reproduced the historical masking defect against original source: an older unresolved attempt kept the sidebar Unknown after a newer task completed. Both new regressions failed on the original projection (browser evidence 365f4cc9-ac27-43bb-9b24-2b321cff9e9f).
- RunnerWork now presents the latest visible attempt; its historical activity and blocked admission calculation remain unchanged. RunnerSessions requires explicitly released execution authority for Idle and gives fresh live execution/attention priority. No new state, timers or reconciliation were added.
- Preserved work.submit, assignment/reservation, safeIdle/reuse, recovery, references, terminal output and unread ownership. Updated the existing terminal specification and corrected stale settings/scroll-container selectors in the focused status test.
- Representation decision: retain RunnerWork and canonical Runner observations as authorities and derive sidebar activity on read. A separate status store or clearing historical uncertainty would introduce synchronization or safety changes and was rejected. Editing, serialization, persistence and cleanup contracts are unaffected.

## 4. Validation Evidence
- PASS: npm run test:e2e -- work.spec.mjs work-discovery.spec.mjs work-background.spec.mjs (57 tests). Evidence: test-results/web-app/7e06d660-2103-4f49-8178-6965701001a4/report/index.html. Includes submission refusal with historical uncertainty, successor activity, whole-work terminal ownership, suspension, unknown outcomes, unread retention and generation fencing.
- PASS: npm run test:e2e -- runners.spec.mjs --grep 'runner status releases|runner circular status' (5 tests). Evidence: test-results/web-app/44d16f5d-f21b-4484-bea7-357c94688d83/report/index.html. Includes TaskRun fixture completion, successive work, authoritative Running/Attention, stale/disconnected Unknown, green Idle/accessible label, unread acknowledgment, themes, geometry and exits.
- PASS: npm run build (TypeScript and Vite production build); existing large-chunk advisory remains. git diff --check passed; modified files retain LF/no BOM and no replacement characters.
- Broader exploratory browser selection fdfb4a45-99b6-4ad7-af98-6f32bd8591a8 timed out at 120 seconds: 12 failed, 3 passed, 54 unexecuted. Failures exposed stale settings and removed composer-button selectors plus the new test's incorrect reconnect expectation. Corrected the directly affected status setup and separated the converged focused batches above. Other historical suite selectors were not expanded into this task.
- Actual native Windows acceptance is recorded separately below; browser fixtures do not close the original installed-Runner TaskRun symptom.
- PASS (actual native, narrower claim): node tools/native-probe/hub.mjs --case semantic-work --runner-root D:/Codex/codex_workspace. The final run used the existing installed Runner in a new fixture-owned nonactivating Hub, completed real Pure Direct Provider work, and asserted correlated INTERACTIVE_READY/no owned execution/no workflow plus the green Verified idle marker. Evidence: temp/native-probe/375ab163-c8e3-4cc9-90cf-e166557684b0/semantic-work/evidence.json; native case and cleanup passed. The added observation lives in the existing semantic-work helper, with no product test seam.
- Remaining actual-host gap: the existing native semantic-work case selects Pure Direct, not TaskRun, and does not seed historical unresolved work. An actual TaskRun completion with retained historical uncertainty followed by fresh released authority has not been observed. Its fixture regression passes, but original TaskRun symptom closure remains unverified. No native TaskRun acceptance is claimed.

## 5. User Verification Message
- The presentation correction passes focused fixture regressions and the production build. Historical unresolved Work still blocks submission and reuse. Actual installed-Runner TaskRun completion/status acceptance remains unverified; do not treat fixture PASS as closure of that stronger reported symptom.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"209","task_workload_id":"81f85416497648ceac21decb6a1e5f73"}
<!-- TASK_END_RUNTIME_METADATA_END -->
