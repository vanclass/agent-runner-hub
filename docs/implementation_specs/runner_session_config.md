# Runner session configuration

## Responsibility and entry points

`src-tauri/src/desktop_terminal/features.rs` registers the implemented native feature surface, while `session_config.rs` owns typed session configuration requests and sanitized responses. The existing `control.rs` owns authentication, exact wire identity, monotonic request IDs, FIFO correlation and completion. `control_windows.rs` continues to own private pipes and its nonblocking worker. `runner_feature` uses the existing Tauri window/session ownership check and returns native admission without waiting for a remote owner while holding a session mutex.

`RunnerControl` composes one `RunnerConfigService` per Runner session and feeds it native snapshots. The service owns drafts, verified catalogs, plans, request completion, application receipts and post-apply observations. `RunnerConfigPanel` owns presentation within the existing settings surface. The current Runner API contract is AgentRunner's `SESSION_CONFIG.md`; Hub does not implement settings owners, consent or configuration-file writers.

Native capability discovery follows an authenticated completed observation. Only locally implemented feature/version/operation combinations are exposed. A native instance generation, together with the owning PTY session, fences frontend results without exposing process/session/connection wire identities or the private key. An unbound startup snapshot cannot establish that identity. Exited instances reject late publication; changing the selected tab never retargets a request.

## Requests, completion and bounded waiting

The typed feature wrapper selects `session_config` and an inspect, plan or apply request. Native adds the unchanged v1 authentication/identity envelope. Inspect can carry an account pair, offset and options guard. Plan carries desired settings. Apply carries the exact desired/revision/plan_id returned by a ready plan. Options evidence is inspect-only.

Explicit request kinds separate observe, command, reference, image and feature completions. Configuration results cannot become observations or change observation freshness. Admission distinguishes local validation/encoding failure, submission with unconfirmed Runner admission, queued admission and pre-admission rejection. Only a matching completed result can supply owner evidence. Pending interaction remains owned by the existing Runner terminal; Hub supplies no answers.

The native worker continues reading and writing while remote owners work. Each Runner has its own worker, and frontend waits consume snapshots rather than blocking the worker or a shared mutex. Same-session requests retain Runner FIFO ordering. Queued does not establish configuration processing or work start; canonical work start evidence belongs to the separate work feature.

Completion deadlines are request-specific and apply to the FIFO head. Followers receive their own waiting interval when the preceding request settles, so an ordinary reference/image/observe cannot expire solely because a valid configuration request is ahead of it. The bounded limits are owned in `session_config.rs`; they account for Runner's paged model RPCs, policy checks and repeated apply validation. Existing terminal-owned pending interaction remains exempt from the normal completion deadline. A separate bounded frontend delivery grace classifies missing receipts without replay.

Native tracks frame byte positions: an untouched outgoing feature frame is provably not sent; partial/full transmission without a definitive response remains unknown. EOF, timeout and connection loss preserve that distinction and all already-completed receipts. No uncertain apply is automatically repeated, reassigned or inferred successful from coincidentally equal current values.

## Verified candidate catalogs

`runnerConfigContract.ts` validates the typed projections and page invariants. Each collection starts at offset zero and captures native instance identity, requested account, returned catalog account, revision, options_revision and totals. Guarded continuation sends the first options token unchanged and requires the exact next offset, expected page lengths/progress, stable Run Modes, matching evidence/totals/account and unique stable candidate identities.

Candidates remain private to the collection until a validated terminal null next_offset. Rejection, stale/state change, unavailable catalogs, bad/missing pages, identity mismatch or lost completion discards the entire collection. A later explicit refresh starts over; no partial pages or models are reused. Reading a destination account never switches the Runner account. Changing accounts invalidates the plan and requires that account's own catalog.

Without options_revision support, only a provably complete single page can become a catalog. Incomplete/unverifiable selections remain disabled with terminal guidance. Missing or unsupported session configuration does not disable legacy commands, references, images or PTY interaction.

## Draft, plan and apply

Actual configured settings, effective execution settings, next execution settings, the user's draft and saved Hub defaults remain separate. IDs come from candidate records, including the full agent_id/profile_name account pair. Unlisted values remain visible and are never replaced automatically. Model/reasoning/tier combinations must match the destination catalog; Root is explicit input and Runner performs its actual filesystem/policy checks.

Direct/Pure Direct Root supports typing, paste and the shared [native directory picker](runner_terminals.md#single-entry-assignment). Selection changes only the current configuration draft; it never plans or applies. Draft replacement, tab unmount, competing operations and native session end invalidate an outstanding picker result.

Planning changes nothing. Invalid and confirmation-required plans cannot enable Apply. The panel shows differences, sequential/non-atomic effects and original diagnostics. Context release or Brief discard requires the official terminal workflow. Draft edits and new inspection invalidate a plan. Immediately before apply, the service explicitly reinspects and rejects a changed revision; Runner still repeats its own authority and applicability checks before commitment.

Completed per-setting outcomes retain success, rejection, cancellation, failure, unknown and not-attempted independently. Success requires an owner acknowledgement and a matching committed projection; ordered stops and aggregate status are validated. Earlier success survives partial failure and a failed final inspect. Inspection proves current state, not causation for an unknown request. A delayed authoritative receipt can resolve a delivery timeout only for its exact request in the same live native instance; final observation remains separate.

## Preferences and Single Entry boundary

`runnerConfigDefaults.ts` maps target registry identities, exact agent/account pairs, model IDs/reasoning/tier, canonical Run Mode and Direct Root through verified complete candidates. A stored account label cannot recover an agent/account identity, even when the current label matches; it remains unresolved and the user selects an exact account pair. The reverse safe projection requires verified candidates and current observation evidence. No guessed storage migration is introduced.

The existing preferences.v1, workspace and installation contracts remain owned by their existing stores. Configuration drafts, revisions, plans, option tokens, private wire identity and uncertain results are process-local. Single Entry calls the same service while reserving the exact Runner, applies only a ready plan and requires verified receipts and final inspection before work submission. The panel disables competing mutation controls during that reservation; terminal confirmation remains user-owned. Active or uncertain configuration excludes another automatic assignment. Configuration success never means work admission or start; that boundary is owned by [Single Entry work submission](runner_terminals.md#single-entry-assignment).

## UI and evidence destinations

`TaskPanel.tsx` composes Single Entry defaults or the selected Runner's configuration and command presenters beside the central workspace. It owns only panel collapse and responsive presentation; preferences and each Runner service retain their existing independent state. The panel scrolls independently, and narrow windows expose it as a collapsible overlay without shrinking the terminal/composer beneath it.

Execution Target groups Target, Run Mode and the Direct/Pure Direct-gated Root. Model Settings groups Account, Model, Reasoning and Fast. Fast maps explicitly to the existing `default`/`fast` tier contract and is disabled when the authenticated model lacks either choice. Unsupported retained values stay visible. When the model supports default, an explicit default-tier action preserves the selected model and unrelated values through `SingleEntry.setDefault` or `RunnerConfigService.setDraft`; selecting fields never applies configuration. Verified current/effective/next settings remain separate from the local draft. Single Entry preserves saved model members across account/model selection and requires explicit resolution of incompatible values before assignment.

The English/Korean catalogs cover labels, actions, progress, plans, partial results, errors and accessibility. IDs, commands, paths and original diagnostics remain original. The panel uses existing Light/Black variables. `RunnerControls.tsx` presents readable slash shortcuts using localized labels where defined and canonical command descriptions otherwise, including secondary commands promoted to the primary area. The collapsible secondary area preserves dispatch, availability, diagnostics, hide/show and ordering through `RunnerControl`. Toolbar App Settings retains installation, language and theme management.

- `session_config_tests.rs`: capability/version/guard validation, request encoding, completion classification, correlation, bounded waits and transmission uncertainty; existing command/reference/image suites remain independent regression checks.
- `session_config_acceptance.rs`: explicit Windows installed-public-Runner discovery and isolated two-session API/receipt/stale-evidence/cleanup checks through the production native client. The existing native acceptance prerequisites and explicit selectors apply.
- `tests/e2e/session-config.spec.mjs` and `session-config-delivery.spec.mjs`: service contracts, guarded/legacy pagination, destination accounts, plans, failure outcomes, identity fencing, defaults and late delivery.
- `tests/e2e/session-config-ui.mjs`, registered by `runners.spec.mjs`: actual panel interactions through the simulated native boundary, both languages/themes, tab isolation, partial receipts and final observation failure.
- `tests/e2e/task-panel.mjs`, registered by `runners.spec.mjs`: desktop column geometry, independent scrolling, keyboard collapse, narrow overlays, retained unsupported defaults/Fast, per-tab drafts, invalid plans and slash dispatch through the simulated native boundary.

Synthetic catalogs and pipe/browser fixtures do not establish external Provider authentication or real destination-account catalog acceptance. Native public-process/transport evidence, actual provider evidence, packaged-product evidence and macOS acceptance are separate claims. macOS Runner launch restrictions remain unchanged; no paid macOS workflow is implied.
