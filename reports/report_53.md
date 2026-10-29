# Session Report

## 1. Task Info
- Task Number: 53
- Task Title: Separate Hub bootstrap from managed React
- Task Title (KR): Hub 진입점과 관리형 React 분리
- Summary: Preserve Hub startup while restoring Runner-owned React source for the deferred canonical Project Update.
- Summary (KR): Hub 시작 동작을 보존하고 후속 Project Update를 위해 Runner 관리 React 소스를 복원한다.

## 2. Work Plan
- Compare the customized React module with applied ownership evidence and the installed canonical resource; preserve all unrelated owners and settings.
- Move Hub mounting, StrictMode and HMR cleanup into src/hub/entry.tsx; point index.html there and retain src/main.ts unchanged.
- Restore the managed React resource, update only the architecture entry description, and validate the source conflict boundary, production build and focused browser/Tauri integration checks.
- Record source migration separately from WG2's post-publication registered Project Update; perform no registered Apply here.

## 3. Work Summary
- Migrated the application chain from index.html -> src/main.ts -> src/frameworks/react.tsx -> Hub to index.html -> src/hub/entry.tsx -> Hub. The project-owned entry preserves global CSS, the missing-#app error, StrictMode and HMR root.unmount cleanup. No Hub component, state, session, persistence or native terminal source was changed.
- Restored src/frameworks/react.tsx exactly to the installed Runner resource at agent_runner/resources/project_management/components/web_app/frameworks/react.tsx. Kept src/main.ts and its managed mount/createGame contract unchanged; the default counter remains available only as an unused managed integration.
- Updated only the bootstrap sentence in docs/ARCHITECTURE.md. Extended starter browser assertions to require the Hub entry and exclude the demo. Repaired installation-setup.mjs selectors from generic input to textbox, preserving every assertion and all other bytes; the existing dialog also contains a confirmation checkbox.
- Preserved package.json, package-lock.json, tsconfig.json, .runner/project.json and src-tauri/tauri.conf.json byte-for-byte. Tauri 2, Desktop Terminal, Native I/O, Build System, CI and application-specific sources remain selected/intact. No registered mutation or SCM/report preference change occurred.
- Specification decision: no specification impact. The existing implementation_specs index routes shell behavior directly to Hub source/tests; the bootstrap extraction is source-obvious and changes no installation/session contracts. The architecture entry boundary was updated; no new feature specification is warranted. The exact AgentRunnerHub Workspace project-policy index was absent.

## 4. Validation Evidence
- Original cause: customized managed source SHA-256 59727e8be8df318db07ab7a75f522aa8fe9ffc132b780e27eca7128fbecd8bc5 differs from both canonical source and applied source proof f79cae9ef12f20c01d1f482d88f8279ed03a9d9888a064fa9b01266d33a2fbf0. The restored file equals both, byte-for-byte, UTF-8 without BOM with LF. Runner resource_bytes and _line_style conventions were inspected; no ownership hash was rewritten.
- Exercised installed Runner frameworks._source_changes read-only with actual Task state and the original HEAD module supplied only through a scoped read mock: rejected with WEB_APP_FRAMEWORK_CONFLICT, source differs from the owned module. The same Update function accepts the restored current source and returns an unchanged main.ts bridge. Actual _check_dependencies passes. This closes the original source guard boundary without performing Apply; the error is not a dependency or lockfile failure.
- Read-only runner_project catalog for AgentRunnerHub succeeded. The registered target is D:/Codex/agent-runner-hub; management/source root is D:/Codex/codex_workspace. React remains selected with exactly one pending operation, Update WebApp/Frameworks/React. Applied resource digest f3c6cf86ede1aaaabf1fd2c48e846d54c02413b0ecd7318515efb612e679d80d differs from current digest 739e3fa46f3b138008e0ed1e100dfe6b459b60fba83737bab4c1374b28f1204c. Source eligibility is validated; registered Update success is not claimed.
- npm ci --no-audit --no-fund succeeded; npm run build passed TypeScript and Vite production compilation. Vite reported its large-chunk advisory. Built dist assets contain AgentRunnerHub and omit the managed demo slogan. Tauri frontendDist remains ../dist and the existing devUrl/configuration is unchanged; frontend integration compatibility is verified, native window/build/PTY acceptance is unverified.
- Focused browser batch: npm run test:e2e -- tests/e2e/starter.spec.mjs tests/e2e/hub.spec.mjs tests/e2e/runners.spec.mjs --grep 'ordinary browser startup|reserved navigation|Runner order|keyboard navigation|covers every surface|installation setup:' produced 5 passes and 8 failures. Startup, navigation ordering/rename and both theme/resize tests passed. Seven failures were ambiguous input selectors; these were repaired without assertion changes. Artifact: test-results/web-app/6bd28277-1f75-4eb1-8e6a-81ab94f49638/report/index.html.
- Rerun npm run test:e2e -- tests/e2e/runners.spec.mjs --grep 'installation setup:' passed all 7 checks. Artifact: test-results/web-app/5774f81f-96b4-47fe-815f-cd8a8fe1aafe/report/index.html. These test mandatory setup, locale/theme layout, missing native runtime, pending saved verification/restoration and settings/restart behavior. Native transport is simulated; this is browser integration evidence only. Both fixtures verified checkout identity, loopback listeners and owned server teardown.
- Remaining unrelated failure: hub.spec.mjs keyboard navigation expects the composer textarea to receive focus after Home, but it is disabled. tests/fixtures/hub.html -> hub.tsx directly mounts Hub with simulated sessions, imports neither main.ts nor either React entry, and all its source/dependencies are unchanged. No production or fixture behavior was altered to mask this separate shell-fixture issue. This limits that keyboard acceptance claim, not the entry migration or source-conflict result.
- git diff --check passed. Source LF/no-BOM/no-replacement-character checks and bounded diff checks passed; installation selector repair preserved all non-target bytes including Korean text. No report validation or Runner-owned completion gates were executed.

## 5. User Verification Message
- Source migration is ready for ordinary Runner publication: the Hub retains its project-owned startup and the original managed React source guard accepts the restored source. Actual registered Project Update has deliberately not run from this unpublished Task worktree.
- WG2, after ordinary publication/integration into the registered Hub checkout: call runner_project with operation=catalog and project_id=AgentRunnerHub, then operation=update, project_id=AgentRunnerHub, items=["WebApp/Frameworks/React"], baseline_id=<fresh catalog project.baseline_id>. Do not reuse the pre-publication baseline. Preserve saved SCM/report preferences and all other selections. Rediscover catalog afterward, verify no pending React Update, and rerun the focused Hub startup/build checks against the registered result. This is the exact remaining canonical application boundary, not a manual receipt repair.
- Actual native-window/PTY acceptance remains unverified, and the independent shell-fixture Home-to-disabled-composer focus test still fails as documented above. No native-host acceptance or registered Apply success is implied by the passing source/build/browser checks.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"53","task_workload_id":"acbc827c223a43e887d7c9286aaee8ea"}
<!-- TASK_END_RUNTIME_METADATA_END -->
