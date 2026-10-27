# Hub localization and local preferences

## Responsibility and bootstrap

`src/hub/i18n.ts` owns the i18next/react-i18next instance, English source catalog, Korean catalog and semantic messages. `Hub.tsx` reads `HubPreferences` and initializes that language synchronously from embedded resources before rendering the shell. Missing preferences select English and Light independently of browser locale. Language changes update document language and visible labels without remounting Runner sessions. Both languages use the same layout and left-to-right direction.

Hub-owned UI, status, validation, tooltips and accessibility labels use semantic keys and named interpolation. Retained Hub messages store keys and values so a later language change also updates earlier errors and assignment evidence. Runner output, agent responses, user names, paths, commands and protocol values remain original. Uncoded native errors retain their raw diagnostic text; the Hub does not infer error identities from English prose. English is the runtime fallback for a missing translation, while automated catalog checks reject missing, unused or mismatched entries.

## Independent preference storage

`preferences.ts` owns the versioned `agent-runner-hub.preferences.v1` local-storage document and the explicit language, theme and Single Entry selection projection. The application uses the existing desktop WebView/browser origin's local storage; it requires no Runner settings API, extension storage or cross-project runtime dependency.

The store accepts the supported schema and values, projects only the known nonsecret selection fields, and writes one atomic storage replacement after a user changes a setting. It never derives defaults from a Runner observation without a user selection. Missing data uses defaults without creating a preference record during startup or draft editing. Malformed, unsupported and unreadable data remains untouched; this window uses defaults and disables preference writes. If another window changes the record, the older window also retains that original rather than replacing it. A failed write keeps the last saved record and displays a translated warning while current window choices continue working.

`RunnerWorkspace.ts` and `RunnerLocation.tsx` retain their independent workspace and installation keys, validation, write and recovery contracts. The preference projection includes no authentication material, PTY identity, terminal contents, drafts, instruction bodies, reference state or uncertain execution outcomes.

## Single Entry boundary and reuse

`EntryDefaults` remains the active request model for target, complete model tuple, account label and run mode. `projectEntryDefaults` validates and copies its safe persisted form. New selections must match fresh observed values; clearing a selection returns to the assigned Runner's verified setting. Restored choices are labeled as requests and remain subject to fresh assigned-Runner comparison before submission. A missing or changed setting leaves the instruction unsent and opens no automatic settings answers.

`HubPreferences.update` is the Hub-side persistence interface; `RunnerSessions` supplies the restored snapshot and a narrow save callback to `SingleEntry`. These interfaces can be reused by later supported settings work. They provide no authority to mutate Runner settings or restore an assignment. The existing assignment implementation remains under the [Runner terminal specification](runner_terminals.md#single-entry-assignment). No inactive allocation-policy control is shown. The [hidden spare and promotion owner](runner_terminals.md#hidden-spare-and-promotion) is available separately from assignment policy.

The authenticated configuration panel keeps saved defaults separate from actual Runner state. `runnerConfigDefaults.ts` explicitly maps verified stable candidate identities and model/tier fields; a persisted profile label cannot recover account identity and remains unresolved for user selection. The existing storage format is unchanged. See [Runner session configuration](runner_session_config.md#preferences-and-single-entry-boundary) for that conversion boundary and the reusable service; current Single Entry assignment and submission remain owned here and by the terminal specification.

## Evidence destinations

- `tools/i18n/check.mjs` and `tests/i18n/catalog.test.mjs`: locale parity, named variables, source arguments, unused keys, untranslated JSX and negative validation cases; `npm run test:i18n`.
- `tests/e2e/preferences.spec.mjs`: first-render language, both themes and languages, accessible layout, new-page restoration, malformed/unreadable data, write failures and concurrent-record retention through the installed browser fixture.
- `tests/e2e/runners.spec.mjs`: current Runner observations remain separate from defaults; user-selected defaults survive reload and are revalidated; live language/theme updates preserve terminal, process, control, image and reference ownership through the simulated native transport.
- Existing native Rust and platform build paths remain unchanged. Browser simulations, native compilation/tests, packaged WebView persistence and actual manual acceptance are separate evidence levels.
