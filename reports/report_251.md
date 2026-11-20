# IssueRun Candidate Report

## Task Info
- Task Number: 251
- Task Title: Runner tab drag reordering and domain moves
- Task Title (KR): 러너 탭 드래그 재정렬 및 도메인 이동
- Summary: Tabs can be reordered within a domain or moved between visible run-mode domains. A cross-domain drop updates the dragged tab's requested mode and keeps its session, work and draft attached.
- Summary (KR): 러너 탭을 같은 도메인에서 재정렬하거나 표시된 실행 모드 도메인으로 이동할 수 있다. 다른 도메인으로 이동하면 해당 탭의 요청 실행 모드가 바뀌며 세션, 작업, 초안은 유지된다.

## Work
### Plan

- Extend the existing native sidebar drag with source and destination captures and reuse the row midpoint indicator.
- Validate both lists in RunnerNavigation. Keep same-domain drops order-only and coordinate cross-domain order with the dragged session's existing requested-mode edit before notification.
- Exercise the Candidate's browser fixture and update the indexed navigation specification.

### Implementation

- Sidebar captures source and destination membership and order for the lifetime of the native drag. It renders the existing insertion line at the destination and clears it when the drag leaves the list, ends, is cancelled or becomes stale. The tab drag data uses a private type so a text field cannot consume the UUID as dropped text.
- RunnerNavigation validates both ordered lists and the anchor against the current projection, then prepares the new order. Same-domain drops save presentation order through the existing workspace path. Cross-domain drops reuse the dragged UUID's HubSelections mode edit and commit its mode, affinity and order synchronously before observers run. A shared drop transaction preserves the existing selection and navigation owners and avoids a second settings store or native configuration operation.
- Updated the existing `docs/implementation_specs/runner_navigation.md` ordering contract. Its implementation-specification index route already identifies the affected owners and focused tests. The frozen AgentRunnerHub project policy index was absent at its canonical path.

## Validation

- `npm run build` passed. Vite reported its bundle-size warning.
- Eleven focused tests passed in the Candidate's headless Chromium fixture. Real pointer movement verified insertion before a row and at list end, keyboard order, Escape, stale membership and reload. The cross-domain scenario verified one UUID, disappearance of the empty source, immediate and deferred Task Settings changes for selected and unselected tabs, preserved explicit Root, terminal, work and composer draft, and unchanged peer settings. The synthetic native transport recorded no configuration plan, apply or work submission from dragging.
- Focused navigation and session tests verified stale source and destination captures, invalid anchors, locked and unsupported modes, and consistent settings and order at subscriber notification. The updated specification's owner and test references resolve. UTF-8, LF, report identity and diff checks passed.
- The initial broader browser selection timed out and included a terminal read-only shortcut case that failed to reach the Single Entry composer. That case exercised no tab drag. Earlier focused attempts missed the destination marker and read the fixture catalog during a refresh after releasing the lock. The final focused run passed with explicit pointer movement over the destination and readiness checks around the fixture refresh.

## Review

- User verification in Hub uses **By execution mode** under **App settings → Domain display**. Drag a tab before a row or to the end of a visible list, then open the moved tab and check its requested mode and mode-specific fields in Task Settings. Reload to confirm the order and mode were saved.
- Independent Review remains pending. Validation used Chromium with synthetic native responses.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-120","work_group_id":"wg-02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
