# Session Report

## 1. Task Info
- Task Number: 180
- Task Title: Restore canonical Runner presentation in Hub
- Task Title (KR): Hub의 정규 Runner 출력 복원
- Summary: Restore the historical presentation consumer and integrations while preserving authenticated submissions and compact composer behavior.
- Summary (KR): 인증된 제출과 간결한 입력창 동작을 유지하며 기존 출력 소비자와 통합을 복원한다.

## 2. Work Plan
- Restore RunnerPresentation, its view and styles from local history; reconnect control observation and bounded cleanup without changing Runner producers or native transport.
- Restore affected state and browser coverage, adapting viewport and installed-Runner acceptance to semantic output while preserving PTY fallback and protocol processing.
- Update terminal specifications and run focused browser, build, native transport and isolated Windows acceptance checks. Record actual outcomes and remaining limitations.

## 3. Work Summary
- Restored the historical RunnerPresentation state/pump, RunnerPresentationView and CSS byte-for-byte from caa96b8's parent. RunnerControl again binds authenticated session/generation observations; RunnerSession releases presentation before PTY termination with the original bounded owner. RunnerTerminal selects semantic output or unsupported xterm fallback while keeping the protocol parser mounted.
- Preserved WG1 submission and WG2 composer source. Restored state/fragment/Activity/generation and bounded cleanup coverage; added semantic submitted-input exactly-once and /help checks, failed-stream warning/history checks, and supported-session composer geometry/draft tests. Updated affected native probes to retain visible-tab/PTy/generation correlation and observe canonical output.
- Updated docs/implementation_specs/runner_terminals.md and IMPLEMENTATION_SPEC_INDEX.md to describe canonical semantic output and fallback; updated the directly affected native probe instructions. Project policy index at the exact AgentRunnerHub environment is absent. No Runner-owned producers or native transport contracts changed.

## 4. Validation Evidence
- Build: npm run build passed TypeScript/Vite; native staging also built the same frontend successfully. Browser state tests passed for pagination, Unicode fragments, Activity snapshots/replacement/retirement, gaps and generation replacement. Focused browser rerun e52979db-9c36-42e0-ac6f-6ea36fa9342e passed 26 checks; eb8fc27b-dfd7-4b3e-aa10-8ccb1c4d837a passed both exactly-once submissions plus /help; c31ec08a-76b0-48af-b08c-8728b2e3d7f1 passed 9 viewport/composer/fallback checks including failed-stream warning and history retention. Initial pre-readiness hidden-parser innerText assertions failed; corrected to textContent, and all three reruns passed.
- Native transport: node tools/hub-native.mjs test --test-filter presentation_tests --target-dir <checkout>/local/native-probe/target passed all 6 authenticated generation-bound presentation tests. Node native fixture/lifecycle/platform/build-owner checks passed all 22 cases.
- Actual Windows invocation temp/native-probe/0fc0bc86-e70b-4f4f-b9c2-368bfbb1ac76 passed single-entry-work and semantic-work against the installed Runner. Single Entry: tab 6ba275aa-314f-41f1-aa71-c890668a9adb, PTY 0, generation 1, request 30, canonical start/success, instruction count 1. Long bilingual: tab 1db1111a-1c1f-4a66-8060-ebac76d77dde, PTY 1, generation 2, request 20, canonical start/success, instruction count 1; composer 294px editing returned to 74.5px immediately after Enter and confirmed start cleared the draft. Displayed semantic viewport was 452.9px high and unobstructed; screenshot inspected. Both exact owned processes settled, resources released, and no activation was observed.
- Initial installed /help receipt completed, but the literal /help output assertion timed out: actual help lists commands without listing /help itself. Revised the probe to bind new canonical records to the completed command and retain their actual output. A retry collided with the native test build lease before launching any case; retained blocked evidence at temp/native-probe/cae78dda-1a79-4bad-ab69-185c46b9f3b7. Final command-only verification passed at temp/native-probe/f28e479e-6659-4dd7-a820-9652167b8ca5: tab 15dd51fc-c885-42db-b950-e4db78a207e5, PTY 1, generation 2. Captured actual Runner command guide after completed /help, subsequent canonical semantic rejection, hidden parser, visible 452.9px output and 74.5px composer. Screenshot inspected; resources released and no activation observed. The initial failed assertion and blocked retry remain retained separately from the final pass.
- npm run test:i18n: 3 checks passed, catalog aggregate failed only on the pre-existing unused hubLog.unsaved key (present and unreferenced at HEAD). Presentation keys are used and locale pairs match; unrelated Hub log cleanup left outside scope. git diff --check passed; restored source files match historical bytes, new text has no BOM, UTF-8 rereads pass, and modified file EOL profiles are preserved.

## 5. User Verification Message
- Canonical Runner presentation is restored for supported sessions, with explicit coverage warnings on incomplete/failed streams and the existing visible PTY fallback for unsupported sessions. Actual Windows checks verified /help output, exactly-once Single Entry and Runner-tab instructions, long bilingual composer compaction, canonical-start draft clearing and unobstructed output. Focused browser, build and native transport checks passed. The separate locale aggregate remains failed only for the existing unrelated unused hubLog.unsaved key; no task-owned completion or report-validation gates were run.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"180","task_workload_id":"d2565073982a443187e0a1e9f53ea802"}
<!-- TASK_END_RUNTIME_METADATA_END -->
