# Session Report

## 1. Task Info
- Task Number: 267
- Task Title: Refresh Hub configuration after same-session Provider changes
- Task Title (KR): 동일 Runner 세션의 Provider 변경 후 Hub 설정 갱신
- Summary: Audit and correct Provider-scoped configuration and submission in Single Entry and retained Runner tabs.
- Summary (KR): Single Entry와 기존 Runner 탭에서 Provider별 설정과 작업 제출 동작을 점검하고 수정합니다.

## 2. Work Plan
- Trace authenticated observations through native transport, configuration catalogs, Hub selections and work submission. Reuse applicable evidence from the completed Runner tasks.
- Correct verified Hub defects in the existing owners. Preserve independent startup settings, user preferences, session identities and work authority.
- Run focused native and frontend regressions and exercise the configured Runner installation. Record installed integration evidence separately from fixture evidence and update affected specifications.

## 3. Work Summary
- Already correct. Authenticated native observations carry effective and configured startup Provider separately, command availability comes from the observed session, and the test-account request is qualified and checked against the exact Provider and installation. Existing authentication, work ownership and recovery contracts still govern admission. Runner Tasks 6065, 6068 and 6076 supply switching, execution and continuation evidence at the Runner boundary.
- Confirmed in Hub source and exercised through fixtures. Copied session defaults were persisted in the same form as deliberate choices, which left previous-Provider values on a retained tab. An inspection could publish current settings before completing pagination and checking the Provider. A later Provider change during attachment staging could also leave the verified configuration disconnected from the work submission.
- Hub now refreshes the same session's choices on Provider changes, restores explicit selections per Provider and clears inapplicable account/model choices. Configuration reads and pending plans carry a Provider revision, including when the session changes away and back. Single Entry filters incompatible reuse and promotion candidates, and both submission paths check the destination again before sending work.
- Updated the existing `runner_session_config.md` and `hub_preferences.md` specifications. The Project policy index was absent for the exact Target.
- Legacy qualified preferences have no provenance marker. Hub preserves them as explicit picks for their original Provider. New snapshots distinguish session-derived values from deliberate choices.

## 4. Validation Evidence
- **Controlled fixtures.** The focused frontend checks covered retained-tab catalog and preference refresh, missing and None Provider evidence, stale pagination and plans, a switch during attachment admission, and work delivery through the original hidden spare. The Windows Rust fixture covered command and capability replacement on an authenticated connection, and the existing session-configuration tests passed for request correlation and Provider-qualified acceptance.
- **Installed Runner.** Read-only native discovery found the configured Codex startup and verified both Provider-qualified test accounts on the installed Runner. The owned session closed normally. The background Hub probe observed Codex, Claude, Codex and Claude on the same tab and Local Control generation with startup still set to Codex. On the return to Codex, Hub showed 3 account and 10 model choices, `gpt-6.2-sol`, xhigh reasoning and Fast available. For Claude it showed 2 account and 14 model choices, Sonnet high effort and Fast disabled. `/usage` and `/issue-run-reasoning` were available on Codex and absent on Claude.

- The installed tab also observed Claude → None → Codex → None → Claude. At None, Hub exposed zero account and model choices, disabled Fast, and the native command view omitted `/account` and `/model`. The Session Configuration API remained observable and configured startup stayed Codex. The other retained tab's observed selection matched its pre-switch selection.
- Focused validation passed for `npm run build`, 97 frontend service and preference checks, and 14 Rust transport and configuration fixture checks. Independent Claude Thinking remains with Runner's terminal model settings. Hub's existing Session Configuration API supplies the model, effort and service-tier controls.
- The installed `provider-switch` probe passed. It verified PTY 2 and Local Control generation 3 throughout the matrix. Single Entry promoted the original Codex spare and received an accepted `/help` reply for request 65 on that same spare. The native process and listener settled normally. See `temp/native-probe/33e59ca9-ef34-413c-9448-52157c0e8aef/provider-switch/evidence.json`. The frontend Single Entry fixtures also passed for Provider-scoped work, exact destination settings in both Hub languages, and idle reuse.

- **Installed work acceptance.** The full switch probe reached the work stage and timed out without a confirmed work result. The focused retry verified the switched Claude session and qualified test account, then stopped because the session supplied no Direct root. The installed Direct preference refers to a folder that has been removed. Its value and revision were preserved. Model inference through both Hub entry points remains unverified with the installed Runner.

## 5. User Verification Message
- The installed Hub verified in-place Provider switching and Single Entry's promotion of the original spare. The remaining installed work check requires a valid Pure Direct working root available to the Runner session. The focused fixtures verified configured work submission and rejection when a Provider change invalidated the configuration during attachment admission.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"267","task_workload_id":"20947a372d7744b199809c3de1472347"}
<!-- TASK_END_RUNTIME_METADATA_END -->
