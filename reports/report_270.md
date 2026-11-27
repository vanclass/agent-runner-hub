# Session Report

## 1. Task Info
- Task Number: 270
- Task Title: Audit and repair Hub Runner lifecycle
- Task Title (KR): Hub Runner 수명 주기 점검 및 수정
- Summary: Trace Runner ownership from restored workspace records through native process settlement and durable tab removal.
- Summary (KR): 작업 공간의 탭 복원부터 네이티브 프로세스 종료 확인과 탭 삭제 저장까지 Runner 소유권을 추적합니다.

## 2. Work Plan
- Follow installation selection, startup, restoration, connection, recovery, allocation, reuse, restart, exit, removal, and shutdown through the Hub and native owners.
- Reproduce the unavailable-installation path. Correct confirmed lifecycle and cleanup defects and present localized diagnostics with retained native evidence.
- Run focused regression and isolated native checks where supported. Update the affected specifications and record each symptom and verification limit.

## 3. Work Summary
- Traced installation admission and changes through RunnerLocation and the native resolver, restoration and persistence through RunnerWorkspace and HubPreferences, launch and exit through the native PTY registry and Windows Job Object, and control and work recovery through RunnerControl and RunnerRecovery.
- The obsolete installation path failed native resolution before Runner process creation. The Hub previously stored the launch error outside the terminal and then treated the missing handle as unconfirmed termination during removal. Native pre-spawn results now distinguish failure from unknown ownership. The terminal shows the failed stage, original path, native detail and next action in English or Korean.
- Separated process settlement from PTY stream, exit-status and ancillary cleanup errors. Close attempts are shared while in flight and can be retried after failure. Removed tabs can show a retained log, retry the exact native owner, or dismiss the log while native cleanup ownership remains in the window registry.
- Made tab persistence precede removal, cleared tab-owned navigation, settings and recovery references, and kept the prior tab visible when its workspace write failed. Preserved independently valid tabs when saved navigation was malformed. Preserved recovery references when launch, connection or recovery could not settle.
- Checked Single Entry reservations and delivery checks, verified idle reuse and promotion, spare replacement, paced global restart, and native/window shutdown. Removed duplicate retained owners on restart failure, stopped stale restart publication, and made session teardown and delayed launch joins use the same close settlement. Single Entry dispatch, Runner recovery reference format and native control transport retain their existing contracts.
- Updated the Runner terminal, navigation and Hub preference specifications and obsolete assertions. No project policy index was present in the task manifest.

## 4. Validation Evidence
- Reported symptom 1, empty terminal after restoration from the obsolete installation. The isolated Windows Hub restored a tab pointing to a missing `codex_workspace` path. Its terminal displayed that original path with the native `missing-installation` code. English and Korean browser fixtures also verified the localized action, original path, retained recovery reference and unaffected neighboring tab.
- Reported symptom 2, permanent termination-failure row after removing the failed-launch tab. The background Windows probe removed the tab without a retained failure row. A full Hub process restart restored only the two valid tabs and confirmed the removed tab's preferences were absent. Both Hub processes exited normally without forced cleanup or foreground activation. Evidence is in `temp/native-probe/2272c0b6-7a4a-4f06-9377-465193aaa9a1/background-workspace/evidence.json`.
- The same installed-Runner probe exercised normal creation, authenticated control, read-only terminal command execution, global restart, persisted reorder and restoration, and exact background termination of a removed Runner while its neighbor stayed available.
- 62 focused Chromium cases passed across four batches for installation, removal, persistence, recovery, restart, spare ownership, Single Entry and navigation. They exercised conclusive exit with a stream error, uncertain launch without a handle, late PTY open, failed and unconfirmed termination, retry and log dismissal, canceled replacement, and durable settings cleanup. Native transport results in those browser cases are fixtures.
- Nine focused Windows Rust tests passed for pre-launch rejection and reservation cleanup, installation resolution, independent PTY ownership, window cancellation, unacknowledged-output shutdown and rejection of a restricted Job handle. TypeScript/Vite build, English/Korean catalog checks and scoped diff and encoding checks passed.
- The original Hub profile and incident logs were unavailable. The Windows probe used an isolated reconstruction and the configured Runner installation. A live installed Runner under deliberately denied termination, Provider-backed recovery of historical work, and macOS runtime behavior remain unverified.

## 5. User Verification Message
- A restored Runner whose installation disappeared shows the saved path and launch diagnostic in its terminal. Removing that tab removes its workspace entry and saved settings. If a Runner's termination is unresolved, open its retained log for the available retry action. Dismissing the log leaves native cleanup with the Hub.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"270","task_workload_id":"827c06bface24c519bc3da2439700a5c"}
<!-- TASK_END_RUNTIME_METADATA_END -->
