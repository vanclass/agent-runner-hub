# Runner navigation presentation

## Ownership and storage

`src/hub/RunnerNavigation.ts` owns execution-mode history, per-tab display affinity and display-order operations. `Hub.tsx` composes one domain projection for Sidebar, numbered/adjacent shortcuts and selection after removal. `Sidebar.tsx` owns only transient drag input and insertion feedback. Native sessions, settings, drafts, unread state and work/recovery authority remain with their existing owners.

`RunnerWorkspace.ts` validates and serializes the optional presentation subrecord in its existing v1 envelope. It contains only supported executed modes, UUID display order and mode affinities for retained tabs. Creation order remains the stable naming/restoration identity. Missing metadata loads empty; malformed metadata protects the original envelope from writes. Atomic save failure preserves the committed record and its warning/retry behavior. No work identity, generation, terminal data, credentials, draft or completion outcome is persisted.

App Settings stores the independent unified/by-mode choice through `HubPreferences.update`; absent v1 choices use unified display. Preference failure and concurrent-write protection remain under [Hub preferences](hub_preferences.md#independent-preference-storage).

## Execution history and domain affinity

`RunnerSessions` forwards already authenticated, validated `RunnerWork` observations. Only confirmed starts contribute modes; current settings, requested selections, admission-only/rejected/unsent or uncertain attempts do not. Both API and terminal origins use the same boundary. Observed modes accumulate without claiming that Runner can restore every previous process's work inventory.

Global history may consume retained/hidden observations. Tab affinity consumes only `presentedAttempts`; an update to an old attempt after hidden-session reuse cannot assign that attempt to the new UUID. The latest actual start within the current work owner outranks display intent and older starts. A fresh process with no new start retains saved affinity. Repeated observations do not duplicate history.

Unified display always exposes one Runner domain, including when empty. By-mode display exposes only supported modes with confirmed history, using the common `runModeLabel` mapping and original protocol IDs. With no history only Single Entry remains. Each tab appears once: its available affinity selects its domain, otherwise the first available supported domain is the fallback. Domain-local add assigns only a new tab's display intent, delegates to the existing single-flight allocation path, and neither changes execution settings nor submits work.

## Ordering and interaction

Drag/drop reorders only a domain's current UUID list. Sidebar renders the actual insertion line during mouse hover. Cross-domain drops, cancellation and stale captured membership/order are rejected and feedback is cleared. The display order never replaces UUID, creation order or native ownership. Domain lists share a flattened order with shortcut and post-removal selection consumers; Single Entry and termination-failure boundaries are retained. Management remains at the right of its heading; a green add button follows each existing domain's last row, including an empty unified domain.

## Evidence destinations and limits

`tests/e2e/navigation.spec.mjs` exercises production navigation/work and persistence contracts, delayed presentation updates, v1 compatibility, malformed metadata, write failure and stale reorder requests. `tests/e2e/runner-navigation.mjs`, registered by `runners.spec.mjs`, exercises production Hub/Sidebar with authenticated synthetic native responses, mouse insertion screenshots, ordering, reload, keyboard selection, unchanged ownership/drafts, domain-local add and English/Korean Light/Black layouts. `runner-promotion.mjs` covers new-UUID attribution after hidden reuse; `hub.spec.mjs`, `preferences.spec.mjs`, `work-discovery.spec.mjs`, `runner-tabs.mjs` and `hub-shortcuts.mjs` cover the directly affected existing boundaries. These browser/contract fixtures establish neither installed Runner execution nor native WebView interaction.
