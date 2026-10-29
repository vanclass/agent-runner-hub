# IssueRun Candidate Report

## Task Info
- Task Number: 47
- Task Title: Native shortcut observation correction
- Task Title (KR): 허브 단축키 설정·로컬 저장과 배정 및 현재 순서 탭 이동 구현
- Summary: Added actual Tauri/WebView2, Windows keyboard and ConPTY observations for the retained native-coverage rejection; production source remains unchanged.
- Summary (KR): 실제 Tauri/WebView2·Windows 키 입력·ConPTY 관찰로 네이티브 검증 공백을 보완했으며 생산 소스는 변경하지 않았다.

## Work
- Plan: prepare the existing canonical Tauri debug build; launch a dedicated process with a fresh WebView2 profile; verify owned loopback observation and native focus/input where safely available. Preserve prior passing browser evidence and report exact remaining limits.
- Completed: canonical native build and disposable external Runner protocol fixture, with retained process handles, fresh profiles, loopback listener ancestry checks, disabled focus emulation and guarded balanced SendInput batches. No production seams, host permissions or shared Runner sessions were changed.
- Ownership: shortcuts.ts retains matching/event lifetime, Hub selection routing, HubPreferences serialization and SingleEntry/RunnerSessions execution/session ownership. No extraction, representation or coordination-model change was needed.
- Specification decision: no specification impact. Existing hub_preferences.md and runner_terminals.md remain accurate; this correction changes invocation-owned observation evidence, with no production or registered test-path change. The exact Target policy index was absent in the frozen context.

## Validation
- Native build: node tools/hub-native.mjs build completed successfully, including TypeScript/Vite and the normal Tauri debug graph. CLI preparation reused the local npm cache. The existing Vite chunk-size advisory remains nonfatal.
- Native observations: native-7.json and native-8.json passed Windows Home, current-order Ctrl+1/Ctrl+2, middle deletion, draft retention, modal remapping, empty-assignment guard and PTY suppression with an ordinary-Q positive control. native-8 additionally observed restored Alt+Enter allocate once while old Ctrl+Enter stayed inactive.
- Reopen: native-reopen.json passed custom-map restoration and native navigation after full app-process exit/restart in the same isolated profile. Focus emulation was disabled and checked against an owned companion window before native-input claims.
- Retained browser evidence: focused 27, presentation/storage 32 and input regression 4 passed in the predecessor; exact functional source/test hashes still match. The only tested-CSS difference is four Korean comments, with identical executable CSS. Source applicability and copied immutable diagnostics are recorded in the invocation evidence.
- Failed probes are preserved: native-1 used an unsuitable visibility assertion; native-2/3 used an unsuitable console-input observer; native-4/6 failed owned-focus setup before keyboard injection; native-5 stopped at a later focus mismatch. Corrected native-7/8/reopen outcomes do not overwrite them.
- Limits: backend protocol responses are synthetic; actual Windows/WebView2/xterm/ConPTY routing is observed. Native custom assignment reaches production allocation but the fixture lacks work capability. Genuine work-start/default/custom submission remains browser/transport evidence. Physical hardware keyboard, installed IME conversion and packaged/provider acceptance are not claimed. Screenshots capture later desktop focus independently of the per-batch foreground guards.
- Cleanup: read-only checks found every recorded native host, WebView listener and fixture PID absent. Automatic approval review rejected recursive deletion of the verified task-owned temp/wg02-native and temp/wg02-native-target directories with "blocked by policy"; ignored reproduction/build files remain in place. No cleanup bypass was attempted.

## Review
- Worker assessment: REQ-02–REQ-05 and all assigned obligations are supported by applicable retained browser evidence plus the new native observations. F-NATIVE-OBSERVATION-COVERAGE is addressed for independent Review, preserving its original review identity and evidence relationships.
- Only this report is a tracked change. Earlier report_47.md remains unchanged. Runner owns admission, staging/commit, independent Revision Review and publication; this result does not claim IssueRun completion.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-33","work_group_id":"WG-02","generation":2}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
