# Session Report

## 1. Task Info
- Task Number: 181
- Task Title: Verify original Runner terminal output in Hub
- Task Title (KR): Hub의 Runner 원본 터미널 출력 검증
- Summary: Compare the installed Runner's PTY output with canonical presentation and correct only demonstrated Hub consumer defects.
- Summary (KR): 설치된 Runner의 PTY 출력과 정식 표시 기록을 비교하고 확인된 Hub 소비자 결함만 수정합니다.

## 2. Work Plan
- Trace Console, publication queue, physical writer and Hub terminal consumption without editing Runner source.
- Use isolated Windows native Hub acceptance to compare full xterm scrollback, viewport and semantic records for help and correlated submissions.
- If verified PTY output is sufficient, expose the existing xterm and remove redundant Hub presentation consumption while preserving WG1/WG2 and transport behavior.
- Run focused browser/build/native checks and record independent symptom outcomes and remaining owner boundaries.

## 3. Work Summary
- Corrected the Hub-owned output surface: RunnerTerminal now exposes the existing per-session xterm for all supported sessions. Removed the redundant semantic renderer, state/pagination pump, production subscriptions and their obsolete locale strings and consumer-only tests. Native presentation transport and Runner source are unchanged.
- Preserved authenticated instruction/command submission, WG1 publication, WG2 composer logic, stable tab/session identities, terminal buffers, resizing, ANSI parsing/colors, protocol replies and user-origin input isolation. No Hub-generated instruction copies were introduced.
- Traced Console.emit_event_presentation -> retained output sink -> OutputPublicationQueue acceptance/presentation stream -> retained physical transaction -> Windows WriteConsoleW -> Hub PTY bridge -> xterm. Semantic records precede physical acknowledgement; full scrollback includes historical rows absent from the current viewport, while transient prompt/progress rows are terminal presentation rather than durable semantic records.
- Updated the existing terminal specification and its index, native probe instructions and focused browser/native acceptance. Canonical records are read only by the diagnostic test helper, never by the production Hub renderer.
- No exact legacy project policy registration or canonical AgentRunnerHub policy index was present. Used the admitted Project worktree and its existing docs/implementation_specs routes. Specification decision: existing terminal specification and root route updated; no new specification owner required.

## 4. Validation Evidence
- Actual Windows baseline comparison: temp/native-probe/f81175ed-a794-437a-bffb-18530ad8cb78/pty-comparison and a0369a9f-1bc2-4196-a72a-b1ed7144aeb3/pty-comparison-{runner,single-entry}. The installed Runner at D:/Codex/codex_workspace published help and both original instructions into the existing hidden xterm. Earlier assumptions that EventPresentation/help were absent from PTY were disproved.
- Corrected Windows acceptance: node tools/native-probe/hub.mjs --case semantic-presentation --case semantic-work --case single-entry-work --runner-root D:/Codex/codex_workspace --target-dir D:/Codex/codex_workspace/agent_runner/local/native-probe/target. All three cases passed; evidence and actual renderer captures are under temp/native-probe/53d31fe5-2397-48ce-abbc-5dc7da20600b. Each fixture-owned process stopped without forced termination and released its listener/profile. Existing user sessions were not adopted or terminated.
- Original output symptom: PASS. On the same native session/generation, diagnostic canonical durable text was present in the full xterm buffer at help publication. Subsequent actual Runner error output advanced the viewport from row 18 to 25; /model remained in the full buffer while absent from visible rows. Native scrolling returned to row zero. Original transient prompt/status rows and ordinary progress/completion output were also observed; no producer repair is required.
- Single Entry instruction symptom: PASS. Native single-entry-work observed exactly one original instruction in the assigned xterm buffer and canonical records, correlated with its original request, tab, session and generation. Runner-tab work independently passed the same count/start/success checks. Instruction publication was sampled before completion and retained afterward.
- Long composer symptom: PASS. Actual Windows bilingual draft length was 1616; editing height 294 px returned to 74.5 px after Enter, retained the draft during delivery, stayed below terminal output, and cleared on canonical start. Native successful work and renderer captures independently confirm the corrected visible path.
- Focused browser checks: 11 passed for original PTY across true/false/absent semantic capability, no semantic requests, protocol replies, blocked user-origin typing, both submission routes, long/short instructions, composer geometry, scrollback, ANSI output, resizing and tab return. Four additional compact-retained-composer cases passed for started/rejected/unknown/not-sent outcomes, including tab return and retained-draft editing. Evidence: test-results/web-app/7abea34d-a84e-4f0e-af63-df625879f223 and 93602fef-aaeb-42b3-9d6a-526abe6c29ae.
- TypeScript/Vite builds and ordinary native library checks passed. Focused native protocol command node tools/hub-native.mjs test --test-filter presentation_tests --target-dir D:/Codex/codex_workspace/agent_runner/local/native-probe/target passed all six transport tests. These are focused checks, not Runner-owned completion gates.
- Catalog check remains FAILED solely for pre-existing unused hubLog.unsaved. Running the same checker against HEAD source/catalogs and the final source/catalogs returned the identical single error; removed semantic keys add no remaining errors. This is unrelated catalog debt, not an output or composer acceptance failure.
- Earlier corrected-build probe failures were test harness defects (unfocused synthetic Enter; querying a terminal while Single Entry was selected). A concurrent build-lock generation race separately blocked one attempt before native execution. Probes were corrected and rerun after build ownership settled; final acceptance passed without manually deleting locks or weakening assertions.
- Localized LF patches preserved unchanged source bytes, encoding and BOM; modified files retain LF/no-BOM, Korean text is intact, and git diff --check passed. A new scratch file initially received a PowerShell BOM and was corrected immediately before reuse. Source trace locators and SHA256 freshness are retained in temp/task181/source-evidence.json. Native reproduction artifacts retain the probe owner's seven-day review lifetime. No report validation or task-end commands were run.

## 5. User Verification Message
- The Hub now displays the Runner's original terminal output. Actual Windows acceptance passed for once-only instructions through Single Entry and Runner tabs, long-instruction compaction and confirmed-start clearing. Help remains accessible in terminal scrollback after subsequent output advances the viewport. No Runner-owned change or manual verification prerequisite remains for these symptoms. The unrelated pre-existing catalog warning is disclosed above.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"181","task_workload_id":"07db611fd5124d7ca4197e57d797c786"}
<!-- TASK_END_RUNTIME_METADATA_END -->
