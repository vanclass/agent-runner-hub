# Session Report

## 1. Task Info
- Task Number: 268
- Task Title: Installed Hub work submission acceptance
- Task Title (KR): 설치된 Hub 작업 제출 검증
- Summary: Complete Task 267's installed work checks for a switched Runner tab and Single Entry using a task-owned working root.
- Summary (KR): 작업 전용 임시 경로를 사용해 Provider를 전환한 Runner 탭과 Single Entry의 실제 작업 제출을 검증한다.

## 2. Work Plan
- Trace the provider-work probe, Hub Root input and Single Entry allocation.
- Supply a task-owned working directory and preserve the installed Runner preferences.
- Verify each fresh work request through admission, execution and settlement with the intended Provider, account and model. Inspect any uncertain result without replaying it.

## 3. Work Summary
- The provider-work probe now supplies a temporary directory under the task worktree through the existing Hub Root field and selects a Provider-qualified model from the test account's catalog.
- The probe checks the installed Runner's read-only configuration plan before submitting through either composer. The installed Runner's session-configuration owner routes Direct Root changes through the shared Direct preference transaction. Work submission carries only the instruction and has no Root override.

## 4. Validation Evidence
- The focused native probe tests passed (10 checks). The Windows native probe build and ordinary native library check also passed.
- The installed Runner switched the retained tab from Codex to Claude with the same PTY and generation and with Codex still configured as startup. The other probe-owned tab's selection was unchanged. Claude's Provider-qualified plan on PTY 2, generation 3, request 70 was rejected with `DIRECT_POLICY_DETECTED`. Claude's installed Pure Direct policy check scans all ancestors for AGENTS.md, and the task directory sits below the Workspace AGENTS.md.
- The Provider-qualified Codex plan on the original Single Entry spare (PTY 0, generation 1, request 38) was accepted and ready. Both plans reported `direct_root_preference: official_owner_update`. The installed API would publish the new Root to `local/config/direct-policy.json` upon successful apply, so the probe stopped both routes before work admission. Single Entry work allocation, actual execution settings, execution settlement, and successful completion remain unverified. No uncertain work was replayed.
- The installed `direct-policy.json`, `runner-preferences.json`, and `runner-settings.json` had identical before and after SHA-256 hashes. Direct preference revision remained 83. The owned Hub and listener settled normally, and the temporary working directory was removed.
- Native receipt and teardown evidence is in `temp/native-probe/37f16266-4c2a-4b85-8640-bc1894281f9a/provider-work/evidence.json`.

## 5. User Verification Message
- Acceptance remains blocked. The installed Runner needs a session-scoped Root that leaves the saved Direct preference unchanged. The Claude Pure Direct check also needs a task-owned directory outside the Workspace policy ancestry.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"268","task_workload_id":"54a4279591564882a76b7dd0418d284f"}
<!-- TASK_END_RUNTIME_METADATA_END -->
