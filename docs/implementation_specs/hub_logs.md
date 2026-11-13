# Hub event history

## Lifetime and ownership

`Hub.tsx` composes `HubLog` and its `HubLogCapture` adapter independently of the keyed Workspace. Capture observes public allocation, assignment, configuration, connection, command and original-work outcomes. View detachment affects presentation only. The recorder neither launches processes nor sends or retries Runner instructions. `HubPreferences` owns retention selection; workspace restoration and Runner buffers remain separate owners.

The projection retains component/operation, relevant Runner and Target, expected/actual state, safe code and next action. Raw exceptions and interpolated user content, instruction bodies, credentials and media are excluded. Structured message identities remain visible when arbitrary details cannot safely be retained. Duplicate observations of the same current outcome are suppressed; actual-start, rejection and uncertain-delivery states remain distinct.

## Durable order and failure boundary

`src-tauri/src/hub_log.rs` owns the main-window-only `hub_log` command and app-local `hub-logs/events.jsonl`. Its process-wide serialized native operation restores records before append or age pruning, assigns ordered identity and timestamp, and syncs append bytes. The frontend queue restores before submitting queued startup events. Original stored fields pass through one formatter for live and restored display; restoration never replays Runner effects.

Valid retained history is independent of the renderer's progressively expanded window. Pruning uses the persisted preference, keeps records at the cutoff, and stages replacements only inside owned log storage. Idle cleanup runs through the same owner. Missing preferences select thirty days; [Hub preferences](hub_preferences.md#independent-preference-storage) owns input validation and saved-value protection.

Malformed history is preserved byte-for-byte, with valid lines exposed and further writes stopped. Read, write and prune failures expose stable storage codes. The frontend retains previously loaded history and explicitly marks pending records as unconfirmed; memory display does not prove a save, and uncertain writes are not automatically replayed. A repaired storage location is reloaded on the next application start. The logger cannot guarantee survival of records whose native save failed.

## Presentation and evidence

`HubLogView.tsx` uses the central Single Entry output area and existing terminal/theme vocabulary with read-only monospace records. Older retained records remain reachable; rendering never truncates storage. Settings and failure labels use the English/Korean catalogs.

Representative evidence: `tests/e2e/hub-log.spec.mjs` covers queue ordering, capture lifetime, deduplication/privacy, preference migration and view/settings behavior. `src-tauri/src/hub_log/tests.rs` exercises actual disk round trips, controlled-time expiration and parse/I/O preservation. `tests/native/webdriver/hub-log.mjs`, selected through `tools/native-probe/hub.mjs`, exercises an actual Candidate Hub and Runner tab, app-local disk and a fresh native process using the same isolated data. Native platform claims require that case's recorded result; browser transport simulations alone do not establish native survival.
