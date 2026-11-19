# Session Report

## 1. Task Info
- Task Number: 211
- Task Title: IssueRun composer confirmed-start cleanup
- Task Title (KR): IssueRun 시작 확인 후 입력 정리
- Summary: Trace canonical work start, originating draft and attachment ownership; repair only verified Hub transitions and preserve uncertain delivery and replay guards.
- Summary (KR): 작업 시작 확인과 원본 입력 및 첨부 소유권을 추적하고 불확실한 전송의 재실행 방지를 유지합니다.

## 2. Work Plan
- Trace submit receipts, status/observe reconciliation, start authority, draft identity and reference leases. Inspect available ir-103 execution evidence read-only.
- Repair the smallest verified Hub defect; retain rejected/uncertain inputs and keep active-work submission guards while permitting a new draft after confirmed start.
- Exercise image and multiline submissions, late observations, tab identity and duplicate prevention; run focused browser/protocol checks and production build. Attempt supported isolated native observation or report its exact boundary unverified.

## 3. Work Summary
- Verified Hub defect: after confirmed IssueRun start and successful text/image cleanup, terminal input-mode disable sequences froze the empty composer. RunnerComposer now accepts RunnerWork's confirmed IssueRun start as editing evidence; active/unresolved work submission remains blocked by the existing admission pipeline.
- RunnerSession immediate and late cleanup now use RunnerWork.hasConfirmedStart, preserving its identity, ordering and consistency checks rather than reading a retained start number directly. Existing original-draft comparison and attachment finishSubmission remain the cleanup owners; no Runner protocol, Single Entry, Brief/Run, recovery or WG7 classification changes.
- Added browser cases for IssueRun multiline/image submission, rejection, unknown delivery, late matching start while switching tabs, new draft/image preservation, released attachment ownership and duplicate prevention. Updated the existing terminal specification.
- Original screenshot disposition: retained ir-103 state identifies creation by session 038ff98e744a0536bc525303ba384757 and later rebound ownership. Its session journal records Interpreter activity, but no retained original work.submit/status/observe response establishes the screenshot submission's canonical started_event_id. Runner WorkEvidence is process-local. The missing evidence is the original API submission ID, native session/generation and matching Runner-owned Work observation; lifecycle milestones, PTY progress and instruction_admitted cannot replace it. Whether Runner failed to publish start or Hub failed to consume it remains unverified. Existing ir-103 was not adopted, interrupted or resubmitted.

## 4. Validation Evidence
- Before repair, the new IssueRun browser test passed original text/image cleanup but failed because the textarea stayed disabled after terminal input modes were turned off. It passed after the repair. An initial test label mismatch was corrected; missing local dependencies were restored with npm ci.
- Focused simulated-native browser/protocol batch: 46 passed (composer outcomes, Single Entry and Runner late attachment start, Work v1 admission/correlation/fencing, discovery ordering and identity). Artifact: test-results/web-app/2a53d6e9-024a-4fba-a173-42247917e632/report/index.html.
- Final IssueRun cases after narrowing the editing exception to IssueRun: 3 passed, including new-draft image staging and tab return. Artifact: test-results/web-app/0b730beb-79bf-4fc7-b5e2-2e6c253e82af/report/index.html. Final npm run build passed; Vite reports its bundle-size advisory.
- Native harness regressions: node --test tests/native/wg3.test.mjs tests/native/native-probe.test.mjs: 11 passed. These test harness contracts, not actual Windows IssueRun rendering.
- Native protocol regression: node tools/hub-native.mjs test --test-filter work_: Cargo check passed; 13 tests passed, 2 installed-Runner acceptance tests ignored for missing explicit prerequisites. The existing managed host preparation and isolated staged backend were used; source lockfiles and the user's Runner sessions were untouched. Native protocol evidence does not establish the screenshot's rendering or original Work response.
- Actual Windows IssueRun transition: unverified. The isolated existing-Runner semantic-work harness explicitly selects Pure Direct mode; it has no IssueRun/image acceptance case. No actual-Hub repair claim is inferred from browser fixtures or native protocol tests.
- git diff --check passed; modified source/specification/test files retain LF and no BOM. Exact Target policy index was absent at .codex/docs/WORKSPACE/projects/AgentRunnerHub/docs/PROJECT_POLICY_INDEX.md. Existing project implementation-specification index and terminal owner were used.

## 5. User Verification Message
- The verified post-start drafting freeze is repaired and browser-tested, with replay and uncertain-input preservation intact. The screenshot's retained original text/image symptom is not claimed resolved: its matching canonical Runner Work response and actual Windows IssueRun observation remain unavailable.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"211","task_workload_id":"6f06dd1114a949d1b964fbbc130d0400"}
<!-- TASK_END_RUNTIME_METADATA_END -->
