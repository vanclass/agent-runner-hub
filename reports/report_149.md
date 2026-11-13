# IssueRun Candidate Report

## Task Info
- Task Number: 149
- Task Title: Durable Hub logs and retention settings
- Task Title (KR): 허브 로그 영구 보관과 보관 일수 설정
- Summary: Implemented Hub-lifetime event recording, native durable history and configurable retention, independently of the selected Runner view. Windows native restart and focused storage/UI checks passed.
- Summary (KR): Runner 화면 선택과 독립적인 허브 사건 기록, 네이티브 영구 보관 및 보관 일수 설정을 구현했다. Windows 네이티브 재시작과 저장소·UI 집중 검증을 통과했다.

## Work
- Work Plan: Compose a focused recorder above Workspace; serialize native restore/append/prune under app-local data; project safe operation outcomes; add a read-only terminal view and persisted retention setting. Preserve existing Runner control, process and workspace owners. Validate focused order/retention/failure paths, native persistence and presentation, then reconcile affected specifications.
- Work Summary: Added HubLog, HubLogCapture and HubLogView. Hub remains a composition root; selected Workspace views only present history. The native hub_log module owns app-local serialization and age cleanup. Preferences remain the sole retention-setting writer; Runner process/control and workspace-restoration owners retain their authority.
- Representation decision: Structured native records are canonical; the frontend keeps an ordered queue and explicitly unconfirmed pending events. One formatter renders restored/live records. This avoids competing localStorage history, view-owned capture and unnecessary lifecycle abstractions. No raw instructions, credentials, media or arbitrary error interpolation enter event records.
- Specification decision: Created docs/implementation_specs/hub_logs.md for the new stable persistence/lifetime contract after verifying its source and focused tests; registered the root route and updated hub_preferences.md and runner_terminals.md without duplicating the detailed log contract.

## Validation
- Windows native: native-hub-final.log and native-hub-final-evidence.json retain the actual Candidate-loaded Hub, Runner-tab selection, disk round trip and fresh-process restart. The case restored original order/format, appended new records with unique identity and restored seven-day retention. Nonactivating renderer capture was visually inspected; both owned processes exited normally and profiles were released.
- Native storage: native-rust-final.log records all three focused Rust cases passing, including controlled-time expiration, valid-history restoration, preserved parse damage, actual read-only append rejection and failed staging cleanup. TypeScript/Vite and ordinary native compilation passed through the same supported staging commands.
- Browser: browser-hub-final.log records four passing focused log tests. The corrected preferences suite passed 31 cases; preferences-fallback.log closes its remaining stale assertion after updating obsolete Send-button expectations to the current textbox/Enter flow. All earlier failures remain retained as diagnostics.
- Lifecycle: native-lifecycle-final.log records passing isolation/cleanup tests, including restart without releasing the shared fixture profile between owned processes. Source-integrity checks cover UTF-8 without BOM, LF preservation, localized diffs, single native registration/write ownership, Hub/view composition and affected specification links. Existing Korean source text remains intact.
- Limitations: test:i18n remains failed solely for the pre-existing unused sidebar.processes key; the new Hub log catalog entries and interpolation validate. This unrelated stale key does not affect logging or retention. Windows results do not establish macOS execution. No instruction submission or model work was performed. An initial concurrent native build was blocked by its checkout lease; retry after the owning build settled required no lock deletion. A later native display assertion was corrected for WebDriver null serialization before the final passing run.

## Review
- User Verification Message: R08 and R09 are implemented and verified within WG02. Hub logs now survive view changes and restart; retention is configurable and defaults to thirty days. Storage failures preserve available history and visibly distinguish unconfirmed events.
- Independent Revision Review and Runner-owned staging/commit remain pending. This handoff does not claim publication or completion of the whole IssueRun. Earlier reports and Runner-owned Candidate identity remain unchanged.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-82","work_group_id":"WG02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
