# IssueRun Candidate Report

## Task Info
- Task Number: 120
- Task Title: Remove process-count footer and reclaim Runner list space
- Task Title (KR): 프로세스 개수 footer 제거와 Runner 목록 공간 회수
- Summary: Removed the sidebar process-count footer and its exclusive styles; the existing navigation layout now gives the recovered height to the Runner list.
- Summary (KR): 좌측 하단 프로세스 개수 footer와 전용 스타일을 제거하여 Runner 목록이 회수한 높이를 사용하도록 했습니다.

## Work
- Removed only the footer JSX/count calculation in src/hub/Sidebar.tsx, the footer/connection-dot selectors and their unused theme variables in src/hub/hub.css. Existing nav flex and runner-domains scrolling needed no changes.
- Preserved Runner selection, order, names, status markers, add action, Single Entry, restart/termination failures and removal dialog. No process lifecycle, Workspace/composer or WG01 behavior changed.
- Model: removed a derived display projection; Runner state and its canonical owners remain unchanged. No replacement representation, synchronization, component, wrapper or test seam was introduced.
- Specification decision: direct source/test route sufficient. docs/implementation_specs/IMPLEMENTATION_SPEC_INDEX.md still routes shell behavior accurately to Sidebar.tsx, hub.css and tests/e2e/hub.spec.mjs; this source-obvious removal needs no new feature specification. Related terminal/navigation descriptions do not describe the removed footer.
- Project policy index checked in the frozen AgentRunnerHub environment: absent; no project policy leaves loaded. Shared hub.css integration is limited to footer-only rules; Runner owns integration, independent Review and serialized publication with WG01.

## Validation
- Existing shell fixture rendered the actual Candidate Sidebar/CSS with 23 Runner rows in headless Chromium 141.0.7390.37. Same-condition before/final geometry: at 760x560, runner-domains height 308 -> 358px and nav 430 -> 480px; at 760x400, domains 160 -> 210px and nav 282 -> 332px. The removed footer was 50px, including 1px border and 17px vertical padding. Final footer node/text are absent and nav reaches the sidebar bottom.
- At both sizes, all 23 rows/status markers remained; keyboard navigation selected the first Runner, End focused the visible add button, the last Runner was selectable, scrolling reached the end, and Single Entry stayed at the same vertical position. Final screenshots were inspected; no footer or reserved blank strip remains.
- npm run test:e2e -- hub.spec.mjs --grep 'keyboard navigation and scrolling keep Single Entry accessible|Runner order, truncation, selection and inline rename preserve navigation identity': 2 passed. This also exercises inline rename, truncation, selection/order and black-theme navigation. Immutable invocation-owned copies retain the machine result and screenshots. Subsequent cleanup removed only unreferenced --status variables; final geometry rechecked the resulting CSS.
- npm run build: passed TypeScript and Vite build; retained the existing large-chunk warning. No native process lifecycle claim is made: the existing shell fixture simulates native verification. No full suite or native process regression was required for this display-only delta.
- Dependencies were restored from the existing offline npm cache. The temporary probe initially failed because dependencies were absent, then passed after npm ci --offline --ignore-scripts. An initial PowerShell encoding-option rejection wrote no helper; creation was corrected to explicit UTF-8 without BOM.
- Localized diff and exact-byte checks preserve LF/no-BOM source and every Korean CSS comment. No source/test route changes, new tests or new reusable validation infrastructure. Evidence: invocation-owned geometry-before.json, geometry-final.json and retained focused-test diagnostics.
- Final execution-findings JSON Schema and all 21 immutable artifact hashes verified. Automatic approval review rejected both recursive scratch cleanup and a narrower individual-file cleanup as blocked by policy before execution. Ignored temp/wg02 remains; fixture-owned servers were already closed and retained evidence is unaffected.

## Review
- R006 implementation and assigned observations complete within WG02; independent Revision Review and source publication remain Runner-owned. No staging, commit, IssueRun-state mutation or downstream dispatch performed.
- 좌측 footer가 사라지고 목록 가용 높이가 두 창 크기에서 각각 50px 증가했습니다. 기존 탐색·이름 변경 검사 2건과 빌드가 통과했습니다. 네이티브 프로세스 실행 검증은 이번 표시 변경의 검증 범위에 포함하지 않았습니다.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-45","work_group_id":"WG02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
