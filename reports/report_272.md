# Session Report

## 1. Task Info
- Task Number: 272
- Task Title: Restore Runner tab context by Run Mode
- Task Title (KR): 실행 모드별 Runner 탭 컨텍스트 복원
- Summary: Restore each tab's last verified mode, eligible exact context, and Runner terminal history on Hub startup and global Runner restart.
- Summary (KR): Hub 시작과 전체 Runner 재시작 시 각 탭의 마지막 검증된 실행 모드, 복원 가능한 컨텍스트, Runner 터미널 출력을 복원한다.

## 2. Work Plan
- Trace the installed Local Control contract, native process handoff, session configuration, and PTY output delivery.
- Extend the existing recovery coordinator and workspace persistence to capture authenticated connected context and resolve restoration before normal work delivery.
- Preserve exact installation and tab ownership, separate historical output from recovery status, and document the changed contracts.
- Run focused regressions and background native checks with isolated retained-work fixtures. Record any unavailable mode or restart evidence independently.

## 3. Work Summary
- RunnerRecovery consumes authenticated Local Control connected v1 and family eligibility v1. RunnerWorkspace persists the exact connected reference and Base Run Mode together.
- Pure Direct and Direct adopt eligible retained conversations, including those with a completed Turn. Task and Issue adopt only incomplete or suspended workloads. Verified absence and conclusive ineligibility use the session configuration service to restore the mode alone.
- Startup and global restart share the restoration gate. It preserves tab identity, installation root and the saved context until verified settlement. Hub re-reads the connected context after adoption. Failed writes, uncertain adoption, stale results and conflicting evidence preserve the prior committed record.
- Runner supplies historical output through the existing PTY writer. Hub uses the same xterm path for playback and reports incomplete history independently. Explicit removal drops the tab's recovery context and prevents reuse of a Runner with a retained reference.
- Updated the Runner terminal and session configuration implementation specifications. The exact Project policy index was unavailable in the supplied Workspace context.

## 4. Validation Evidence
- Windows installed Runner accepted authenticated `recovery.current` over Hub native transport. Capability discovery, connected v1, the committed mode, fresh verified absence, and request/generation correlation were observed without submitting instructions.
- The Windows background Hub workspace probe passed installation-failure handling, tab isolation, global restart, application restart and removal with the configured installed Runner.
- Nine focused Rust recovery tests passed. Five tests from the installed Runner exercised canonical connected observations, Task and Issue adoption without execution, Direct and Pure Direct successor handoff, and successful adoption with missing history.
- Seven focused Chromium tests passed on the final restoration logic. They exercised four-mode startup and global restart, repeated recovery, ordered ANSI-styled xterm output, independent incomplete-history diagnostics, mode-only fallback, replacement and clear, unavailable installation, delayed and uncertain results, persistence failure and explicit removal.
- Twenty-seven focused startup, whole-work restart, selection initialization and terminal presentation regressions passed. The broader restart run reached the suite limit after 33 passing cases. Two session configuration navigation timeouts passed on isolated rerun, and the other 34 configuration assertions had passed before the broader run's teardown timeout.
- TypeScript, English and Korean localization, and Git whitespace checks passed.

The following observations used the actual Windows Hub, authenticated native pipes, and canonical retained state in an isolated Runner installation. The fixtures supplied the retained work without running new Provider Turns. Startup was observed on first launch and again after closing and reopening Hub.

| Base Run Mode | Hub startup work | Hub startup output | Global restart work | Global restart output |
| --- | --- | --- | --- | --- |
| Pure Direct | Exact conversation with a completed Turn restored on both launches | Both retained lines appeared once, in order | Exact conversation restored in the replacement PTY | Both retained lines appeared once, in order |
| Direct | Exact conversation with a completed Turn restored on both launches | Both retained lines appeared once, in order | Exact conversation restored in the replacement PTY | Both retained lines appeared once, in order |
| Task | Exact workload remained suspended on both launches | Both retained lines appeared once, in order | Exact workload restored and remained suspended in the replacement PTY | Both retained lines appeared once, in order |
| Issue Run | Exact incomplete workload restored on both launches with no live execution | Both retained lines appeared once, in order | Exact workload restored in the replacement PTY without execution | Both retained lines appeared once, in order |

The native retained-work samples used plain historical records. ANSI styling and the independent incomplete-history diagnostic were exercised in Chromium through the existing xterm path. The installed Runner's canonical recovery fixture separately observed successful adoption with unavailable history.

The preliminary suspended Task restart remained pending because Runner disables `/files` and rejects its inventory call in that state. The final background rerun passed after restart switched to the existing reference owner's prepared and unresolved-operation checks for that verified retained context. Native probe cases `retained-recovery-272` and `retained-task-restart-272` retain their mode observations under `temp/native-probe`.

Native probe teardown settled the owned processes. The command tool blocked recursive removal of the disposable fixture directory, so `temp/272-recovery` remains as local reproduction evidence.

## 5. User Verification Message
- The Windows fixture matrix verified startup, global restart, and another Hub launch across the four scoped modes. Task and Issue workloads stayed available for explicit continuation. The Hub terminal showed the original ordered history in each replacement tab.

<!-- TASK_RUNTIME_VISIBLE_SECTION_BEGIN {"schema_id":"lifecycle_runtime_visible_section/v1","section_id":"merge_attempts"} -->
## Merge Resolution Evidence

<!-- TASK_RUNTIME_VISIBLE_ENTRY_BEGIN {"content_digest":"sha256:cf3b0efe94dfc4e67f0f5520f3e53faa4545c509eb328f5e20095b3829715150","entry_id":"merge-attempt-1","schema_id":"merge_attempt_entry/v1","section_id":"merge_attempts"} -->
### Merge Attempt 1
- Conflict scope: `tests/e2e/runner-auto-recovery.mjs`
- Resolver outcome: RESOLVED
- Resulting revision: `281da5818d1c53578fff32f536465938a39c559c`
<!-- TASK_RUNTIME_VISIBLE_ENTRY_END {"content_digest":"sha256:cf3b0efe94dfc4e67f0f5520f3e53faa4545c509eb328f5e20095b3829715150","entry_id":"merge-attempt-1","schema_id":"merge_attempt_entry/v1","section_id":"merge_attempts"} -->
<!-- TASK_RUNTIME_VISIBLE_SECTION_END {"schema_id":"lifecycle_runtime_visible_section/v1","section_id":"merge_attempts"} -->

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"272","task_workload_id":"7810e658156e440cb8edf59727034cb0"}
<!-- TASK_END_RUNTIME_METADATA_END -->
