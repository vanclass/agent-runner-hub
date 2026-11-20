# IssueRun Candidate Report

## Task Info
- Task Number: 248
- Task Title: Run-mode domains and tab settings
- Task Title (KR): 실행 모드 도메인 표시 및 탭 설정 동기화
- Summary: Hide empty mode domains, initialize new tabs from the clicked domain, and move the selected tab as soon as its settings accept a Run Mode change.
- Summary (KR): 빈 실행 모드 영역을 숨기고, 영역의 추가 버튼으로 만든 탭에 해당 모드를 설정하며, 실행 모드 변경이 승인되면 선택된 탭을 즉시 이동합니다.

## Work
### Plan

Keep domain visibility derived from visible tabs in RunnerNavigation. Pass the clicked mode into per-tab HubSelections before publishing any new UUID, including both reuse paths. Route validated mode edits through the UUID-bound commit so placement is ready before native draft invalidation can notify listeners. Exercise the existing Hub fixtures and reconcile the indexed navigation specification with the observed behavior.

### Changes

- RunnerNavigation projects only by-mode groups with visible tabs. It keeps historical starts and saved placement in the existing v1 records. Unified view retains its add control.
- Manual allocation overrides the requested mode in HubSelections for a new or promoted UUID. An uninitialized request still adopts verified defaults when options load, and the Direct Root comes from explicit input.
- The accepted per-tab settings commit updates affinity before native configuration draft invalidation can publish the view. Previously observed starts cannot reverse the edit. A newer confirmed start still updates affinity. The UUID, current session, terminal, composer draft and work stay with the tab.
- Updated the existing navigation specification and its index to describe the changed behavior and identify HubSelections as an owner. The linked session configuration specification retains the requested-settings and native validation contract.

## Validation
- `npm run build` passed. Vite reported its bundle-size warning.
- Fifteen focused Chromium checks passed using the Candidate Hub with synthetic native responses. They exercised history-only and emptied domains, final-tab removal, global and unified controls, the Pure Direct plus from an Issue Run baseline, fresh and reused allocations, Direct Root, edit guards, immediate relocation, repeated old starts, and preserved session and draft ownership.
- A broader selection hit two existing shortcut assertions involving Control+Home. Both failed at the same assertions on the unchanged source revision in a disposable fixture. The focused navigation test passed grouped ordering and numbered keyboard selection.
- Checked the specification and indexed source/test destinations against the Candidate and ran `git diff --check`.

## Review
- In by-mode view, use a populated domain's plus to create a new selected tab and check the matching Run Mode in Task Settings. A Direct mode displays its Root field. Changing a selected tab to an absent mode should move the same tab immediately and remove the old section if it was the last tab there.
- Independent Revision Review is pending. Validation exercised the browser UI and synthetic native responses.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-120","work_group_id":"wg-01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
