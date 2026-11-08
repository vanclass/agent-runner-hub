# Session Report

## 1. Task Info
- Task Number: 122
- Task Title: Separate Brief and Run inputs in Hub IssueRun composers
- Task Title (KR): Hub IssueRun 입력에서 Brief와 Run 지시문 분리
- Summary: Extend existing Hub submission and native contracts without changing Runner execution or persistence.
- Summary (KR): Runner 실행과 저장은 유지하고 Hub 제출 흐름과 네이티브 계약을 확장한다.

## 2. Work Plan
- Keep the existing instruction draft as Brief; add an optional Run draft scoped to each composer.
- Extend RunnerBrief to stage only present Brief content, invoke with exact optional text, and retain confirmed-start ownership release.
- Extend TypeScript/Rust requests, update English/Korean labels and the existing implementation specification.
- Run focused production-composer browser simulations, native protocol checks and compilation; distinguish simulated evidence from unobserved host behavior.

## 3. Work Summary
- Both production IssueRun composers keep the instruction draft as Brief and expose a separate optional Run draft. Single Entry and each Runner tab own their own inputs; ordinary Send leaves Run text unsent. Allocation guards, explicit draft transfer and existing restart copying preserve the new tab draft.
- RunnerBrief remains the single sequence owner: shared configuration/attachment admission, staging only when Brief exists, one invocation carrying exact optional text, original-request status observation, then confirmed-start clearing/release. Rejections and uncertain outcomes retain inputs without automatic replay.
- TypeScript and native Rust accept optional run.invoke text while preserving argument-free calls and unchanged run.status. Runner-owned execution, prompt assembly and persistence were not modified.
- Added English/Korean input and Run-only status labels. Updated the existing Brief/Run section in docs/implementation_specs/runner_terminals.md; its existing index route remains valid. No new specification or submission owner was needed.
- Extended existing production-composer simulations and native protocol/pipe fixtures. Corrected stale test assumptions about the Run Mode selector and read-only work.list discovery without weakening submission checks.

## 4. Validation Evidence
- PASS: npm run build (TypeScript and Vite), including final production-source review changes. git diff --check passed; modified files retain LF, no BOM and no replacement characters.
- PASS: five focused native run_tests through the existing staged Tauri build with configured desktop-terminal/native-io features. Optional text round-trips exactly; argument-free calls omit text; invalid non-string values and text on run.status are rejected. Acceptance, correlation and initiation tests remain passing.
- PASS: exact_handle_allowlist_authenticated_roundtrip_and_eof_uncertainty with HUB_CONTROL_PYTHON and --ignored explicitly enabled: the production Windows client transmitted exact multiline Korean Run text to an authenticated synthetic pipe peer. This is native transport evidence, not installed-Runner execution or WebView acceptance.
- Browser production-composer simulations: the extended focused batch passed 15 cases; its one failure navigated to Single Entry before checking a Runner-tab draft. Correcting the test to remain on the originating tab passed the exact rerun. These checks cover both Korean input examples, Brief-only, Run-only without Brief capability, multiline/Unicode preservation, confirmed-start clearing, staging rejection, unavailable Run, unknown admission, single invocation, ordinary Send, keyboard conventions and Run-draft retention.
- Additional initiation simulations passed: Run-text-only deadline retains exact text without staging or replay; existing disconnect, generation, capability and lost-completion checks passed in the expanded batch. The expanded batch retained its failed aggregate (41 passed, 5 failed): stale work.list assertions, one source-reload-interrupted case, and foreground-message/timing expectations were investigated and corrected with focused reruns rather than represented as an all-suite pass.
- PASS: final foreground-ownership race rerun accepts either existing admission guard's specific diagnostic and proves no staging, command or PTY write. Browser artifacts: test-results/web-app/729a2246-75d5-4281-a43d-5d501fea3741 (15 passing focused cases), 84abb255-4541-4127-b101-564bf205332e (originating Runner-tab Send retention), 3f8fdea5-f86f-4b85-bac8-a057b822aa0c (Run-only deadline), and fe7d4fab-1a1b-47ec-8396-00b5b7a377b7 (foreground race).
- npm run test:i18n remains failed solely for the pre-existing unused sidebar.processes key. HEAD contains that key without a Sidebar consumer; changed Brief/Run keys introduced no catalog diagnostics. Unrelated sidebar cleanup is outside scope.
- Initial native attempts exposed missing source Cargo.lock and omission of configured native-io features; the existing staging/lock-resolution owners and applied feature set resolved these prerequisites. Temporary native build staging was removed after settled tests.
- Actual installed Runner prompt assembly, Provider execution and native WebView interaction were not observed. Runner-side concatenation is deliberately outside this Hub change; no actual-host result is claimed from simulated transport.

## 5. User Verification Message
- In either IssueRun composer, enter Brief and optional Run instructions separately. Ctrl+Enter submits through the existing flow; Shift+Enter inserts a newline and ordinary Send keeps its existing behavior. Both submitted inputs clear only after confirmed IssueRun initiation. No manual action is required for the verified Hub integration; installed Runner/WebView end-to-end behavior remains unobserved.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"122","task_workload_id":"fb2ef3effef64b3a917ce4a981e80e7c"}
<!-- TASK_END_RUNTIME_METADATA_END -->
