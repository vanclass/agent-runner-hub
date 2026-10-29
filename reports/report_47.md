# IssueRun Candidate Report

## Task Info
- Task Number: 47
- Task Title: Configurable Hub shortcuts and local restoration
- Task Title (KR): 허브 단축키 설정·로컬 저장과 배정 및 현재 순서 탭 이동 구현
- Summary: Implemented configurable assignment and navigation shortcuts with protected local persistence. Focused browser checks pass; required native WebView input and focus acceptance remains unverified.
- Summary (KR): 배정·화면 이동 단축키 설정과 로컬 복원을 구현했습니다. 집중 브라우저 검사는 통과했으며 필수 네이티브 WebView 입력·포커스 수락은 미검증으로 남습니다.

## Work
- Approved approach: isolate shortcut matching/capture/lifetime under src/hub; preserve Hub selection, SingleEntry submission, RunnerSessions resources and HubPreferences serialization. The authorized delta adds three configurable actions and replaces Sidebar's Home focus-only behavior; transport, OS hotkeys, native permissions and WG-01's Fast changes are outside this Candidate.
- Implemented ShortcutSettings and shortcuts with draft validation, conflict feedback, native dialog focus/trapping/restoration, immediate custom mappings and reset. Hub supplies current IDs and narrow select/submit actions; no full session-owner injection or alternate submission path was added. Preferences remain the single serialization/write owner; window-local UI values follow the existing preference pattern.
- A procedural event handler owns matched keydown/repeat/keypress/keyup suppression. Composition/Process/Dead/AltGraph and open dialogs suspend execution. Current-order lookup excludes Single Entry/Add/failure rows, retains stable sessions/drafts and does not cap tab creation or define Ctrl+0. Clipboard/editing combinations remain reserved.
- Model decision: canonical validated chord strings plus an editor draft use the existing browser dialog and capture-phase events; no editor replacement, hidden-token model, OS service or framework was introduced. Only matched keyboard operations are intercepted; text editing, clipboard and session lifetime stay with existing owners. Old Sidebar Home consumption was removed and its test now checks actual selection and composer focus.
- Specification decision: updated the existing hub_preferences.md and runner_terminals.md owners and the direct runner_session_config.md summary/index routes. Existing canonical owners cover persistence and input/navigation; a duplicate feature document is unnecessary. Exact Target policy index was absent in the frozen Workspace context; no project-specific policy was inferred.

## Validation
- PASS: npm run build (TypeScript/Vite); npm run test:i18n (4 tests and catalog integrity). Vite retains its large-chunk advisory; no build failure.
- PASS: focused shortcuts/storage/navigation batch, 27 tests. Production Hub + SingleEntry + actual xterm are exercised against the existing simulated native transport: default/custom assignment exactly once, blank/pending/preflight constraints, restored mappings, current-order selection after deletion/rename/add, draft/session retention, IME/modal capture and swallowed key releases.
- PASS: final hub.spec.mjs + preferences.spec.mjs, 32 tests; both languages/themes, responsive shell, capture/restoration, malformed/unreadable/concurrent originals and write failure. PASS: 4 input regressions covering terminal arbitration, clipboard image/text paste, two independent terminals and original button-driven Single Entry submission.
- Retained diagnostics include the initial no-tests selector error and two failed fixture-convergence runs. Selector was corrected; terminal input required the existing canonical foreground-interaction fixture and asynchronous work needed its existing observation timeout. No production guard or assertion was weakened. Final applicable suites passed. Browser evidence is not native acceptance.
- UNVERIFIED: actual supported WebView key delivery, focus and terminal arbitration. Native readiness inspection found Rust/MSVC/SDK/WebView2 but the checkout-local Tauri CLI was unprepared. The available native helper offers compilation/protocol tests, while this invocation has no registered native UI interaction/observation mechanism. No shared host was attached, new production seam added, or host/security permission requested. Installing CLI alone would not establish the required observation.
- PASS: localized diff, documentation links, UTF-8/no-BOM, preserved LF and exact existing Korean CSS comments; new tuning comments explain changed spacing. Final CSS-only presentation adjustment was rechecked through the 32-test presentation batch; subsequent comments are behavior-neutral. Immutable diagnostic copies and byte-hashed output references accompany the Worker result.

## Review
- Partial handoff for independent Revision Review: implementation and browser obligations are complete; DoD 5 and validation obligation 3 remain blocked specifically on native WebView acceptance. REQ-02–REQ-05 are not declared wholly complete. Preserve passing evidence and determine an admitted isolation-safe native observation path for the remaining work.
- 지시문 배정은 Ctrl+Enter, Single Entry 이동은 Home, Runner 이동은 Ctrl+숫자 키로 사용할 수 있으며 상단 단축키 설정에서 변경할 수 있습니다. 브라우저 검증은 통과했지만 네이티브 입력·포커스 수락은 확인되지 않았습니다.
- Runner retains staging, commit, Review routing, publication and IssueRun completion. Source HEAD remains unchanged; this report describes only unpublished WG-02.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-33","work_group_id":"WG-02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
