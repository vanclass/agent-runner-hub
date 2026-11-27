# Session Report

## 1. Task Info
- Task Number: 269
- Task Title: Installed Hub Native Work Submission Acceptance
- Task Title (KR): 설치된 Hub의 네이티브 작업 제출 검증
- Summary: Verify actual native execution through a retained Runner tab after a Provider switch and through Single Entry using an existing supported path.
- Summary (KR): 기존 지원 경로를 사용해 Provider 전환 후 유지된 Runner 탭과 Single Entry에서 실제 네이티브 실행을 검증합니다.

## 2. Work Plan
- Reuse Tasks 267 and 268 for Provider switching and configuration evidence. Confirm which installed execution path can run a bounded read-only probe under the existing accounts and preferences.
- Submit only through the existing Hub entry points. Correlate each request with its effective Provider, account, model, native execution and settled Turn. If a prerequisite is unavailable or a submission is uncertain, preserve the evidence and record the remaining gap without replay.

## 3. Work Summary
- Reused the Provider-switching, configuration, and Direct Root evidence from Tasks 267 and 268. The configured Direct directory was still missing at preference revision 83.
- Used the installed Runner and its configured test accounts through an isolated background Hub. Submitted one read-only IssueRun Discussion from the switched tab and one from Single Entry, each with a distinct response token and the bound AgentRunnerHub target. The configuration plans allowed session-only changes and preserved existing work.
- Reconciled both original requests against Runner's retained artifacts. Both Discussions settled with read-only authority. Each IssueRun remained in Discussion. The probes created no implementation worktree and triggered no publication. No request was replayed and no production code changed.

## 4. Validation Evidence
- **Retained Runner tab.** Tab `033fb72a-c4c8-470a-b8de-fa764bd2d86a` stayed on PTY 1, Local Control generation 2 when its effective Provider switched from Codex to Claude. Startup remained Codex and the separate spare's observed selection matched its opening selection. Configuration plan 75 was ready and Work request 84 was accepted. The authenticated selection and frozen role binding matched the configured Claude test profile and Sonnet at high effort. In `ir-139`, invocation `20dfd1ed08f642598ffee0605f90c341` bound the exact prompt to the committed response. The Claude SDK reported success with no error and included Claude Sonnet 5.5 model usage. Native session `d8caddbc-18bc-46ab-9487-77622de153cf`, execution ID, response token and checkpoint matched the settled Discussion.
- **Single Entry.** Configuration plan 278 was ready and Work request 293 was accepted on the promoted spare, PTY 0, Local Control generation 1. The authenticated selection, role binding and App Server checkpoint linked the configured Codex test profile and `gpt-6.2-sol` at low effort to `ir-140`, invocation `59aad8dd9a7e4b42976a190305d246ff`. The live Interpreter and native `turn/completed` notification matched Thread `01a21bd6-77ab-7a40-ba87-479caebf3021` and Turn `01a21bd6-7fe2-7841-9f85-01f3d2c5a9db`. The committed response contained the Single Entry token and the Discussion action settled.
- **Evidence reconciliation.** The Windows native build and ordinary Rust library check passed. The background observer timed out and marked the case unverified. Its verification used a file-byte hash for a canonical JSON context digest and assumed a common Provider artifact layout. Read-only reconciliation of the two original requests verified the canonical context digests, immutable prompt and response artifacts, and Provider-specific native checkpoints and terminal records. The Runner retains these records under `runs/workloads/issue_runs/ir-139` and `runs/workloads/issue_runs/ir-140`. The wrapper and clean Hub teardown record is `temp/native-probe/b00cf134-5544-4660-8e61-6f674661d931/discussion-acceptance-269/evidence.json`.
- Before and after SHA-256 hashes matched for `direct-policy.json`, `runner-settings.json`, and `runner-preferences.json`. The owned Hub exited normally, released its loopback listener and removed the isolated profile.

## 5. User Verification Message
- Installed work submission and successful native Discussion Turn settlement were verified for both Hub entry points. The two IssueRuns remain in Discussion with their original Runner-owned records.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"269","task_workload_id":"34513eee1aa447b6a67de7e85751b6eb"}
<!-- TASK_END_RUNTIME_METADATA_END -->
