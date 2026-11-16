# IssueRun Candidate Report

## Task Info
- Task Number: 176
- Task Title: Restore generated image consumer verification
- Task Title (KR): 생성 이미지 검증 도우미와 소비자 테스트 복구
- Summary: Restored the saved generated-image helper and synthetic consumer fixture, registered browser/native callers, and retained genuine source/input limits separately.
- Summary (KR): 생성 이미지 검증 도우미와 합성 소비자 테스트를 복구하고 실제 이미지 및 입력 검증 한계를 별도로 유지했다.

## Work
- Work Plan: Recover the hash-bound saved helper/fixture into existing test owners, adapt current callers, run the normal build and focused consumer checks, and update directly affected specification routes.
- Work Summary: Added attachment-preview.mjs and generated-consumer.mjs; registered the fixture in runners.spec.mjs and the read-only generated path in native preview-views.mjs. Extended ownedConnection with an optional exact-session selector while preserving default single-session behavior and generation/installation checks. Production source is unchanged.
- Specification decision: Updated the existing runner_terminals.md description and IMPLEMENTATION_SPEC_INDEX.md test routes; no new specification owner. Exact Target project policy index was absent in the frozen context.

## Validation
- Validation Evidence: npm run build passed (TypeScript/Vite; existing bundle-size warning). Current focused Chromium run passed all 8 cases: populated, empty and no-input generated fixtures plus affected Runner/Single Entry local image/text and Help checks. node --test tests/native/wg3.test.mjs passed all 8 native-helper contract cases. Native caller syntax/loadability is checked separately; no actual native generated-image or physical-input success is claimed.
- Applicability assessment (R04/R05/R06 question 0): The seven retained production owners remain unchanged; restored helper, fixture, exact-session lookup and registrations were exercised on this Candidate with its lockfile-installed dependencies and owned headless Chromium/Vite loopback server. Historical reviews and failed aggregates remain historical. Current fixture evidence supports only assigned capability properties.
- Scoped-result assessment (R04/R05/R06 question 1): Retained authenticated inventory was empty and no authorized native input adapter was available. Those unchanged external probes were not repeated. Genuine owning-connection retrieval/rendering, genuine header/Escape/return and genuine native wheel/pan/reset remain unavailable or unsupported by current observations, separately from supported synthetic properties. Full product claims remain with WG07.
- Integrity: Localized LF patches preserve existing encoding, non-ASCII comments and report identity. No production seam, foreign-session adoption, generation or invented filename was introduced. Existing specification updated only for changed test routes.

## Review
- User Verification Message: Assigned synthetic verification capability is restored and validated. Genuine authenticated image/native-input acceptance remains unverified. Runner retains independent Review, commit, integration and publication; no commit or publication was performed by this Worker.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-95","work_group_id":"WG03","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
