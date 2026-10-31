# Session Report

## 1. Task Info
- Task Number: 73
- Task Title: Verify private reference inventory in the native Windows Hub
- Task Title (KR): Windows 네이티브 Hub 비공개 참조 목록 표시 검증
- Summary: Three fully observed private inventory reads completed in the actual Windows Hub without unsolicited /files lines, command submissions or registrations. Explicit interaction, scrollback, tab isolation and owned cleanup were verified; no production repair was needed.
- Summary (KR): 실제 Windows Hub에서 비공개 목록 조회 3회의 완료와 무단 /files 표시, 명령 제출 및 참조 등록이 없음을 검증했다. 명시적 메뉴 조작, 스크롤 기록, 탭 격리 및 정리를 확인했으며 제품 코드는 수정하지 않았다.

## 2. Work Plan
- Reuse the previous native WebView and process-ownership observation path; identify the actual installed Runner source and corrected private transcript behavior before acceptance.
- Build the current Hub only as required, launch a fresh owned Hub/profile and Runner without changing saved account preferences, and exercise authenticated read-only inventory with its terminal visible.
- Correlate each request/completion with command dispatch, outgoing PTY and visible lines; verify explicit /files output, scrollback, tab isolation and ordinary shutdown without model execution or registration.
- Repair only a proven Hub-owned defect; otherwise record the precise Runner prerequisite/failure separately. Preserve historical attribution separately and settle all owned diagnostics/processes.

## 3. Work Summary
- RESOLVED on the current actual Windows Hub acceptance path: three authenticated private inventory reads produced no unsolicited /files presentation, user-command submission or reference registration. No Hub or Runner production source was changed; no frontend text suppression was added.
- Reused the native staging/build owner, fresh WebView2 profile, real tauri.localhost page, passive IPC response observation and captured PID/creation/window ownership path. Observed public PTY channel messages without changing their contents or delivery. Read the mounted xterm buffer and visible rows independently.
- Verified the existing installation at D:/Codex/codex_workspace. Its managed Python 3.14.3 resolves runner and lifecycle.py in that installation; compiled bytecode contains the private list transcript guard. Runner source commit 4e7045b0465ba9f9fa77fe05c297c126e6412aee; lifecycle SHA-256 b0d9db8d78928cc470e4ef3fdf14a21d118d98d35c2e122921b046e0f04791c2. No additional Runner installation was created.
- Launched Hub PID 26472, created 2026-10-31T06:39:52.9221925Z, executable SHA-256 d325cbd9931ff24f8434fd1c88bdd02c4f92da7f7a31394e390d499cb55acbeb. Native session 1/generation 2 was Runner 1, owned Runner PID 4488; its creation falls within the recorded pty_open admission/completion interval. Account bailesx2 was available with account_setup_required=false; no account or configuration apply was submitted.
- Submitted one explicit /files through the ordinary composer. Authenticated command 176 opened the normal Files menu; ordinary Cancel was accepted and the initiating command completed with ownerStatus=CANCELLED. Its menu output and explicit command status remained present. A cancelled command did not create a committed terminal transcript entry.
- Preserved startup/status output and scrollback; verified the top viewport at viewportY=0 with baseY=14. Runner 2/native session 2 had an independent draft and no inherited command or reference receipts. Runner 1 retained its own draft and inventory receipts and remained running after Runner 2's tab retirement.
- Retired both visible tabs through their ordinary confirmation controls, then revalidated the exact created Hub PID/creation/HWND and sent WM_CLOSE. All captured Hub/Runner/WebView descendants and the diagnostic listener were subsequently absent. Removed the owned native build cache and WebView profile; retained bounded reproduction evidence under temp/task73-native.
- Historical seven-line attribution remains separate and unchanged. The earlier synthetic seven-line preservation case and Task 72's two observed lines are not counts or causal proof for this corrected-source acceptance.

## 4. Validation Evidence
- Current native acceptance: temp/task73-native/private-inventory.json, acceptance-summary.json and private-inventory.png. Each request below completed accepted with total_count=0, references=[], no registration metadata, zero runner_command dispatches, zero outgoing PTY calls/bytes, zero incoming /files text occurrences after ANSI decoding, and zero /files lines in both mounted scrollback and visible rows.

| Native session 1 request | Completed inventories | Incoming PTY packets / bytes | User-command dispatches | Outgoing PTY bytes | Visible /files lines |
| --- | --- | --- | --- | --- | --- |
| 107 | 1 | 4 / 2246 | 0 | 0 | 0 |
| 108 | 1 | 3 / 1682 | 0 | 0 | 0 |
| 111 | 1 | 1 / 1400 | 0 | 0 | 0 |

- Requests and completions were counted separately from native IPC admissions and authenticated reference results; dispatch calls, outgoing PTY payloads, incoming channel output and rendered buffers were separate observations. Incoming sequences 219-226 retained ordinary loading/status redraws. Buffer lengths changed during those redraws; byte-for-byte unchanged terminal output is not claimed. The underlying Runner still routes each private read through its /files authority with files_request.action=list; the current compiled guard skips DeferredForegroundTranscript only for that action. Internal Python dispatch was source-correlated, not separately instrumented.
- Whole owned run totals: four references.list admissions and four accepted empty inventory receipts; zero references.register, zero work.submit, zero run.invoke, zero session_config.apply. The fourth inventory was an ordinary tab-retirement verification on native session 2, request 208. Its request/completion and outgoing traffic were captured; its incoming PTY channel and post-read terminal buffer were not independently captured. The three fully correlated session-1 reads above are the current presentation acceptance evidence; the incidental fourth is not promoted to equivalent visual evidence.
- Exactly one authenticated user command was requested: explicit /files, request 176/generation 2, pending-interaction followed by completed CANCELLED. Explicit cancellation request 210 completed accepted with input_status=accepted, interaction_status=cancelled and outcome_unknown=false. Across all three native session opens, the only outgoing PTY payloads were one ESC [ O focus notification per session (3 calls, 9 bytes total); none contained /files. See explicit-files.json/png, after-explicit.json and settled-tabs.json.
- Native window evidence: visible Tauri HWND 17960954 and WRY HWND 17437752; actual renderer child is recorded in native-windows.json. Verified WebView2 browser PID 3168 owned only 127.0.0.1:11973; process-tree-active.json binds its ancestry to Hub 26472. Actual native WebView screenshots were inspected, rather than a headless fixture. Reproduction helpers use the existing public native operation and leave Tauri's frozen invoke function intact.
- Scrollback/tab evidence: isolation-final.json, restored-scrollback.png and settled-tabs.json. Startup version/status lines survived explicit interaction and tab restoration; Runner 1 draft differed from Runner 2's draft. Session 2 had zero command/reference receipts before retirement; closing its tab did not terminate Runner 1. Ordinary idle tab retirement may retain an owned spare; final WM_CLOSE settled those processes too.
- Current-source native build emitted Finished dev profile and Executable ready through node tools/hub-native.mjs build, including TypeScript/Vite and Windows MSVC/Tauri compilation. PowerShell reported wrapper exit 1 because npm's allow-scripts warning was surfaced as NativeCommandError; the build continued and produced the exact executable exercised above. The existing Vite chunk-size warning remained. No production repair was needed, so no focused regression suite or duplicate test framework was introduced.
- Cleanup: cleanup-processes.json at 2026-10-31T06:44:55.9566339Z contains zero remaining captured PIDs and zero listeners; artifact-cleanup.json confirms build-cache/profile removal. Runner config.json and the account config.toml hashes were unchanged. All retained decision-source hashes remained unchanged. No unrelated process was closed, no credentials were migrated and no frog request/model execution was submitted. No Runner-owned completion gate or task-end command was run.

## 5. User Verification Message
- Resolved in the actual Windows Hub with the updated Runner: three fully observed authenticated private inventory reads completed with zero unsolicited /files lines, zero user-command dispatches, zero outgoing PTY bytes and zero registrations. Explicit /files still opened its normal menu and cancelled normally; scrollback and tab isolation were preserved.
- No production repair, suppression, saved-preference change or model execution was needed. All owned processes and diagnostics settled. Historical seven-line attribution is unchanged; the extra retirement inventory has request/completion evidence without equivalent incoming/rendered observation, as detailed above.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"73","task_workload_id":"d5aaf93bdaa14d0fb89647b3a82a1e56"}
<!-- TASK_END_RUNTIME_METADATA_END -->
