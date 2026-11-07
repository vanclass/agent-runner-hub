# IssueRun Candidate Report

## Task Info
- Task Number: 111
- Task Title: Execution-based Runner domains and tab ordering
- Task Title (KR): 실행 이력 기반 도메인과 러너 탭 정렬 구현
- Summary: Add persisted execution-mode domains and identity-preserving tab ordering.
- Summary (KR): 실행 모드 이력에 따른 도메인과 정체성을 유지하는 탭 정렬을 추가한다.

## Work
- Plan: Add a navigation feature owner, consume authenticated started-work observations, and persist presentation metadata through RunnerWorkspace. Connect domain preferences, Sidebar drag/drop/add, and current-order navigation while preserving WG01 settings and native ownership. Validate focused production UI and storage paths, then update their specification owner.
- Implemented: RunnerNavigation owns executed modes, display affinity/order and domain projection. RunnerWorkspace alone validates/serializes its optional v1 presentation subrecord; preferences alone store the display choice. Sidebar owns transient drag feedback; Hub composes the same flattened order for display, shortcuts and removal selection. RunnerSessions only forwards existing authenticated work and persistence notifications.
- Model decision: Persist presentation metadata rather than duplicate settings/work authority or reconstruct unavailable global Runner history. Actual started observations outrank display intent; presentedAttempts fence hidden reuse. Creation, UUID, native process ownership, recovery, settings, drafts and unread state remain with their existing owners. Native drag events avoid a parallel pointer-coordinate model; cancellation and changed membership clear feedback and reject stale drops. No new polling, API, listener, dependency, production test seam or compatibility wrapper was added.
- Specification decision: Created docs/implementation_specs/runner_navigation.md after bounded owner resolution: existing preferences and terminal specifications own adjacent settings/recovery, while the shell had only a direct source/test route. Updated the root index and those two consumer specifications to converge on the new navigation owner and retire the obsolete unconditional empty-sidebar add description. WG01 settings descriptions remain intact.
- Focused fixture repairs: Updated obsolete mode-button selectors to the current Requested Run Mode select in shortcut/tab/Brief setup, and replaced a retired bare-Home expectation with Ctrl+Home. Assertions and production behavior were preserved.
- Project policy: The exact frozen AgentRunnerHub environment has no PROJECT_POLICY_INDEX.md. No project-specific policy or Workspace mutation was introduced.

## Validation
- Final build and i18n checks passed; exact output is retained in invocation diagnostics/build.log and test-i18n.log. Dependencies were restored from the local npm cache with npm ci --offline --ignore-scripts after the first build found no installed tsc.
- Final production navigation run b17516b2-64d1-4133-b82f-15b0ca045c80 passed: no-history/empty unified, four started modes, rejection without history, display/add/reload, actual mouse first/middle/end reorder, visible insertion screenshots, cross-domain refusal, cancellation and affinity changes during drag, UUID/process/selection/draft preservation, keyboard position, menu/add geometry, English/Korean Light/Black.
- Production RunnerWork/navigation and persistence cases passed in 6660d63e-5835-449c-8a8e-f4229336123d: delayed prior-presentation updates, duplicate starts, v1 absent fields, malformed/secret-field rejection, failed save preservation/retry and stale membership. The same run passed hidden-reuse attribution and composer/terminal/API discovery cases.
- Existing shell/preferences/work-discovery run 626da4e1-547a-411b-888e-73bd049dc6f8: 65 passed, one obsolete bare-Home expectation failed. Corrected focused run 7085808d-f4ee-4cc3-b878-89209a68f980: all five navigation/shortcut/removal/persistence checks passed, including the repaired Home expectation and mode selectors.
- Retained failures: The 6660d63e aggregate remains failed (9 passed, 6 failed). Four failures were obsolete mode selectors and passed after fixture repair. Two unchanged foreground-composer tests remain failed: pending-read input and foreground-confirmation input expect an enabled composer while RunnerComposer explicitly disables it for session.foregroundInteraction and RunnerSession.submit rejects it in favor of structured controls. Navigation only reads work and reorders presentation; these input-routing contracts and controls were not changed. Their errors/screenshots/traces remain in diagnostics/browser-evidence.zip; they do not leave a navigation obligation unverified.
- Browser evidence uses the existing headless Chromium/loopback fixture with synthetic authenticated native responses. No installed Runner/provider execution or native WebView success is claimed. Visual insertion feedback was inspected in rendered captures. LF/no-BOM, Korean comments, localized diffs, links and changed-path boundaries were checked.

## Review
- R09/R10/R11 implemented and verified within this Work Group; shared R02/R03/R04/R07 constraints retained. Independent Revision Review, Candidate acceptance, commit and publication remain Runner-owned. Changes are uncommitted; source HEAD is unchanged. No planning reconsideration or user prerequisite is requested.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-44","work_group_id":"WG02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
