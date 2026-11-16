# IssueRun Candidate Report

## Task Info
- Task Number: 177
- Task Title: Verify retained Help placement and supported preview catalog
- Task Title (KR): 도움말 확장자 목록과 도구 모음 배치 확인
- Summary: Verified retained R08 Help on this Candidate; build and two focused browser checks passed. No product-code changes were necessary.
- Summary (KR): 현재 후보에서 R08 도움말 배치와 확장자 목록을 확인했습니다. 빌드 및 브라우저 검사 2건이 통과했으며 제품 코드 변경은 필요하지 않았습니다.

## Work
- Work Plan: Reuse accepted PreviewHelp and common catalog; inspect actual routing and obtain current build, placement/opening and categorized-support observations independently of unrelated physical/genuine-image gates.
- Work Summary: Retained Help immediately after App Settings, PNG and original UTF-8 txt/md/json support, and explicit mixed/other unsupported limits. Frontend routing and native dispatch consume src-tauri/src/preview_formats.json. Only this report changed; no specification or lookup destination changed.

## Validation
- Validation Evidence: npm run build passed after npm ci --offline --include=dev restored missing local dependencies. Initial build failed because tsc was absent; the retry passed TypeScript and Vite with the existing large-chunk warning.
- Validation Evidence: npm run test:e2e -- --grep 'preview Help|local preview shared catalog' passed 2/2 on this checkout with Playwright 1.56.1 / Chromium 141.0.7390.37, headless 1280x800. Execution e6c728b3-85c8-433e-97bd-c8b79892cd5c records exact checkout and server teardown.
- Validation Evidence: Inspected catalog-help screenshot: Help is right of App settings, the opened dialog lists Images (.png), Text (.txt, .md, .json), Mixed / other, and truthful unsupported/registration limits. Focus returns to Help on Close. The routing check covers case-insensitive catalog dispatch and unavailable responses. These are fresh browser-fixture observations, not native physical-input or authenticated generated-image observations.
- Applicability: Existing implementation and focused test definitions remain applicable; historical IR-93 judgments stay historical. Fresh build/browser evidence establishes the assigned R08 properties on the current Candidate. The frozen Workspace context has no AgentRunnerHub project-policy index. No unrelated aggregate or platform run was required.

## Review
- User Verification Message: R08's assigned Help properties are verified in the current browser Candidate. Immutable diagnostics and separate product observations accompany the Worker handoff. Independent Review, commit, integration and publication remain Runner-owned; this report does not claim whole-IssueRun completion.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-95","work_group_id":"WG05","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
