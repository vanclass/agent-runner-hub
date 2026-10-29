# Session Report

## 1. Task Info
- Task Number: 55
- Task Title: Hub structured Runner interactions and read-only logs
- Task Title (KR): Hub 구조화 Runner 상호작용 및 읽기 전용 로그
- Summary: Move supported foreground control to authenticated Hub UI; preserve Runner execution, work and independent Brief/Run contracts.
- Summary (KR): 지원되는 포그라운드 제어를 인증된 Hub UI로 이동하고 기존 실행 및 작업 계약을 보존합니다.

## 2. Work Plan
- Validate the existing Runner interaction capability and wire schema in Hub native typed-feature handling without editing Runner.
- Add a session-bound interaction owner and UI for explicit confirmation, selection, single-line text, Back and cancel; retain independent command receipts and block uncertain replay.
- Make terminal input read-only at its origin while preserving parser-generated protocol replies, selection/copy/search/resize; route explicit commands through authenticated control and preserve typed work and Brief/Run delivery.
- Exercise focused component/browser and Rust/native checks, update affected implementation descriptions, and distinguish simulated, native-pipe and unavailable installed-host evidence.

## 3. Work Summary
- Added Hub-native typed interaction capability discovery, strict request/projection/receipt validation, observed choice/action admission, exact session/generation correlation and independent transport while initiating commands remain pending. Runner-owned implementation was not modified.
- Added a per-session structured interaction owner and Hub panel for explicit confirmation approval/rejection, selection, Unicode single-line text, Back and cancel. Canonical prompts, context, consequences and disabled reasons remain Runner-authored. Input acceptance and final command results are separate. Stale/rejected inputs reobserve; uncertain revisions cannot replay; tab switch, generation change, close and exit cannot retarget responses.
- Replaced user PTY control with read-only logs. Removed composer foreground delivery, onData/onBinary forwarding and simulated slash-command typing. Preserved output parsing, Win32 mode/query acknowledgment, internal protocol replies, copy, search, scrolling, resize and tab restoration. Explicit supported commands use authenticated command control; ordinary work and exact independent Brief/Run contracts remain intact.
- Ownership/model decision: RunnerInteraction owns transient observed state and one input attempt; RunnerControl retains native transport composition and command results; RunnerInput owns the pinned xterm origin adapter. Public xterm onData cannot distinguish input origin and disableStdin suppresses replies, so the narrow xterm core-service adapter is retained with production-path tests. No workflow engine, duplicate foreground owner or persisted interaction state was introduced. Obsolete manual-input fields/helpers and locale guidance were removed.
- Specification decision: updated existing runner_terminals.md and runner_session_config.md plus IMPLEMENTATION_SPEC_INDEX.md routes; existing terminal ownership remains the canonical description. Exact AgentRunnerHub project-policy index was absent; no project-specific policy was loaded.

## 4. Validation Evidence
- PASS: npm run build (TypeScript and Vite); npm run test:i18n (catalog/interpolation/source integrity). Vite retains its bundle-size advisory.
- PASS: focused browser interaction/log suite, 13 tests, artifact test-results/web-app/4b413c68-aa10-4cc5-8f47-7f2030dc08f2/report/index.html. Real Hub components and xterm exercised explicit selection, confirmation approval/rejection, Unicode text, Back/cancel, stale/changed-owner rejection, uncertain receipt, generation change, tab switching/exit, read-only keys/Ctrl+C/Ctrl+V/IME/protocol-shaped paste, internal replies, clipboard copy without PTY input, search, scrolling, resizing and restoration. Native bridge/owner projections are simulated; this is not installed-host acceptance.
- PASS: focused work/Brief/Run/Enter regression suite, 8 tests, artifact test-results/web-app/96a7ad4f-3284-4734-aaa8-b45909800a31/report/index.html. Ordinary work verifies settings then submits once; both composers preserve Enter/Shift+Enter/Ctrl+Enter. Exact multiline Brief staging remains independent of one Run invocation; extended simulated execution/human-wait/pause/failure after committed start does not duplicate execution. Earlier command/shortcut/unsupported-foreground regressions also passed in focused browser runs.
- PASS: cargo test --manifest-path src-tauri/Cargo.toml --features desktop-terminal --test control_handles -- --include-ignored --nocapture with HUB_CONTROL_PYTHON set to the available direct Python interpreter: 56 tests passed. This includes native protocol/identity/receipt tests and a real Windows authenticated private-pipe/ConPTY fixture observing/responding while its synthetic initiating command stays pending, with independent final rejection and EOF uncertainty. It does not exercise a genuine installed Runner owner or WebView2 GUI.
- Convergence evidence: initial Rust request-decoder failures were repaired with exact action-field parsing; initial browser assertion/label issues were corrected. Log-height regression was repaired without weakening viewport checks. One combined browser run exceeded its existing suite deadline; the affected suites were split and passed. LF/no-BOM preservation, strict UTF-8 rereads, Korean catalog/report text and git diff --check passed. No report validation or Runner-owned task-end gate was run.
- Unverified platform/host boundary: no isolated HUB_RUNNER_ACCEPTANCE_ROOT/configured installed-Runner fixture was supplied, and this project has no existing isolated WebView2 GUI acceptance fixture. Actual installed Runner interaction effects, native GUI salience/clipboard/IME behavior and genuine long-running installed-host execution remain unverified. macOS Runner launch remains gated by existing containment limitations; Linux/native parity is not claimed.

## 5. User Verification Message
- Supported foreground controls now live in Hub, and terminal logs accept no user keystrokes. Supported owners are TargetScmSelection, ActionConfirmationSelection and single-selection FileBrowser through Runner's shared selector path, including nested text/image-detail/Back/cancel. Multi-selection and specialized Account/login/protected text, Model, Service Tier, Run Mode, Order, Sounds, Recovery, Settlement, Project, Usage, task termination, preparation waits and Task/Agent dialogue remain explicitly unsupported with no PTY fallback. Review final command receipts separately from accepted interaction input. Automated browser and authenticated native-pipe checks passed; actual installed Runner/WebView2 end-to-end acceptance remains unverified.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"55","task_workload_id":"7796598e42984e5c97d55201d36f0941"}
<!-- TASK_END_RUNTIME_METADATA_END -->
