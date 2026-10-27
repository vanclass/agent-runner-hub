# Hub localization and local preferences

## Responsibility and bootstrap

`src/hub/i18n.ts` owns the i18next/react-i18next instance, English source catalog, Korean catalog and semantic messages. `Hub.tsx` reads `HubPreferences` and initializes that language synchronously from embedded resources before rendering the shell. Missing preferences select English and Light independently of browser locale. Language changes update document language and visible labels without remounting Runner sessions. Both languages use the same layout and left-to-right direction.

Hub-owned UI, status, validation, tooltips and accessibility labels use semantic keys and named interpolation. Retained Hub messages store keys and values so a later language change also updates earlier errors and assignment evidence. Runner output, agent responses, user names, paths, commands and protocol values remain original. Uncoded native errors retain their raw diagnostic text; the Hub does not infer error identities from English prose. English is the runtime fallback for a missing translation, while automated catalog checks reject missing, unused or mismatched entries.

## Independent preference storage

`preferences.ts` owns the versioned `agent-runner-hub.preferences.v1` local-storage document and the explicit language, theme and Single Entry selection projection. The application uses the existing desktop WebView/browser origin's local storage; it requires no Runner settings API, extension storage or cross-project runtime dependency.

The store accepts the supported schema and values, projects only the known nonsecret selection fields, and writes one atomic storage replacement after a user changes a setting. It never derives defaults from a Runner observation without a user selection. Missing data uses defaults without creating a preference record during startup or draft editing. Malformed, unsupported and unreadable data remains untouched; this window uses defaults and disables preference writes. If another window changes the record, the older window also retains that original rather than replacing it. A failed write keeps the last saved record and displays a translated warning while current window choices continue working.

`RunnerWorkspace.ts` and `RunnerLocation.tsx` retain their independent workspace and installation keys, validation, write and recovery contracts. The preference projection includes no authentication material, PTY identity, terminal contents, drafts, instruction bodies, reference state or uncertain execution outcomes.

## Single Entry boundary and reuse

`EntryDefaults` carries requested Target, complete model/reasoning/tier selection, exact account identity, Base Run Mode, explicit Direct Root and the always-new/reuse-idle allocation preference. `projectEntryDefaults` validates and copies only these nonsecret fields. Always-new is the default when the optional policy is absent; changing the toggle persists the explicit policy. Clearing a selection uses the allocated Runner's verified setting. Restored choices remain requests and are revalidated through that Runner's authenticated catalogs before submission.

`HubPreferences.update` remains the sole Hub preference writer. `RunnerSessions` supplies the restored snapshot and narrow save callback to Single Entry. Catalogs, drafts, revisions, plans, receipts, work IDs and uncertain execution state remain session-local. These preferences neither change settings by themselves nor restore or replay an assignment. Allocation and submission are owned by the [Runner terminal specification](runner_terminals.md#single-entry-assignment).

`runnerConfigDefaults.ts` maps verified registry identities and model combinations, including the full `agent_id/profile_name` pair. Legacy account-label fields remain readable but unresolved even if a current display label matches. Explicit exact-account selection replaces that legacy preference; no guessed migration occurs. See [Runner session configuration](runner_session_config.md#preferences-and-single-entry-boundary) for catalog conversion and configuration receipts.

## Evidence destinations

- `tools/i18n/check.mjs` and `tests/i18n/catalog.test.mjs`: locale parity, named variables, source arguments, unused keys, untranslated JSX and negative validation cases; `npm run test:i18n`.
- `tests/e2e/preferences.spec.mjs`: first-render language, both themes and languages, accessible layout, new-page restoration, malformed/unreadable data, write failures and concurrent-record retention through the installed browser fixture.
- `tests/e2e/runners.spec.mjs`: current Runner observations remain separate from defaults; user-selected defaults survive reload and are revalidated; live language/theme updates preserve terminal, process, control, image and reference ownership through the simulated native transport.
- Existing native Rust and platform build paths remain unchanged. Browser simulations, native compilation/tests, packaged WebView persistence and actual manual acceptance are separate evidence levels.
