# Runner navigation presentation

## Ownership and storage

`src/hub/RunnerNavigation.ts` owns execution-mode history, per-tab display affinity and display-order operations. `Hub.tsx` composes one domain projection for Sidebar, numbered/adjacent shortcuts and selection after removal. `Sidebar.tsx` owns only transient drag input and insertion feedback. Native sessions, settings, drafts, unread state and work/recovery authority remain with their existing owners.

`RunnerWorkspace.ts` validates and serializes the optional presentation subrecord in its existing v1 envelope. It contains only supported executed modes, UUID display order and mode affinities for retained tabs. Creation order remains the stable naming/restoration identity. Missing metadata loads empty; malformed metadata protects the original envelope from writes. Atomic save failure preserves the committed record and its warning/retry behavior. No work identity, generation, terminal data, credentials, draft or completion outcome is persisted.

App Settings stores the independent unified/by-mode choice through `HubPreferences.update`; absent v1 choices use unified display. Preference failure and concurrent-write protection remain under [Hub preferences](hub_preferences.md#independent-preference-storage).

## Execution history and domain affinity

`RunnerSessions` forwards already authenticated, validated `RunnerWork` observations. Only confirmed starts contribute modes; current settings, requested selections, admission-only/rejected/unsent or conflicting observations do not. `RunnerWork` owns start confirmation independently of completion uncertainty: an admitted positive start still contributes history and current-presentation affinity when its outcome is unknown, without becoming success or reusable idle work. Both API and terminal origins use the same boundary. Observed modes accumulate without claiming that Runner can restore every previous process's work inventory.

Global history may consume retained/hidden observations. Tab affinity consumes only `presentedAttempts`; an update to an old attempt after hidden-session reuse cannot assign that attempt to the new UUID. The latest actual start within the current work owner outranks display intent and older starts. A fresh process with no new start retains saved affinity. Repeated observations do not duplicate history.

Unified display always exposes one Runner domain, including when empty. By-mode display exposes supported modes with confirmed history or a visible tab's provisional placement, using the common `runModeLabel` mapping and original protocol IDs. With no tabs and no history only Single Entry remains alongside global management. Each tab appears once. Confirmed latest starts set affinity; without a start, retained affinity or domain-local add intent wins, then requested selections or last verified mode context supplies initial placement. A tab lacking all context displays under Task Run without creating history. Global process counts read visible session ownership independently of domain projection.

Domain-local add delegates to the existing single-flight allocation path, appends to the intended domain, and neither changes execution settings nor submits work. Editing an existing tab's requested Run Mode does not move a tab with confirmed history. Its next confirmed actual start changes the same tab's domain; UUID, selection, terminal, settings, draft lifecycle and work ownership stay with the existing session.

## Ordering and interaction

Drag/drop reorders only a domain's current UUID list. Sidebar renders the actual insertion line during mouse hover. Cross-domain drops, cancellation and stale captured membership/order are rejected and feedback is cleared. The display order never replaces UUID, creation order or native ownership. Domain lists share a flattened order with shortcut and post-removal selection consumers; Single Entry and termination-failure boundaries are retained. Management remains right-aligned; by-mode display omits the generic Runner heading/count. Each domain's full-width, 48px-high add button follows its last row, including an empty unified domain. The centered plus uses the original pale-green Light styling and dark-green Black styling with their respective hover colors.

## Evidence destinations and limits

`tests/e2e/navigation.spec.mjs` exercises production navigation/work and persistence contracts, delayed presentation updates, v1 compatibility, malformed metadata, write failure and stale reorder requests. `tests/e2e/runner-navigation.mjs`, registered by `runners.spec.mjs`, exercises production Hub/Sidebar with authenticated synthetic native responses, mouse insertion screenshots, ordering, reload, keyboard selection, unchanged ownership/drafts, domain-local add and English/Korean Light/Black layouts. `runner-promotion.mjs` covers new-UUID attribution after hidden reuse; `hub.spec.mjs`, `preferences.spec.mjs`, `work-discovery.spec.mjs`, `runner-tabs.mjs` and `hub-shortcuts.mjs` cover the directly affected existing boundaries. These browser/contract fixtures establish neither installed Runner execution nor native WebView interaction.
