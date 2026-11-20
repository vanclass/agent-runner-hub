# Runner navigation presentation

## Ownership and storage

`src/hub/RunnerNavigation.ts` owns execution-mode history, per-tab display affinity and display-order operations. `Hub.tsx` composes one domain projection for Sidebar, numbered/adjacent shortcuts and selection after removal. `Sidebar.tsx` owns only transient drag input and insertion feedback. Native sessions, settings, drafts, unread state and work/recovery authority remain with their existing owners.

`RunnerWorkspace.ts` validates and serializes the optional presentation subrecord in its existing v1 envelope. It retains mode names, UUID display order and mode affinities for retained tabs, including well-formed unsupported mode names. Unknown names survive save without granting executable support: known domains still restore, and a tab with unsupported affinity uses the Task Run presentation fallback. Creation order remains the stable naming/restoration identity. Missing metadata loads empty; malformed metadata protects the original envelope from writes. Atomic save failure preserves the committed record and its warning/retry behavior. No work identity, generation, terminal data, credentials, draft or completion outcome is persisted.

App Settings stores the independent unified/by-mode choice through `HubPreferences.update`; absent v1 choices use unified display. Preference failure and concurrent-write protection remain under [Hub preferences](hub_preferences.md#independent-preference-storage).

## Execution history and domain affinity

`RunnerSessions` forwards already authenticated, validated `RunnerWork` observations. Only confirmed starts contribute modes; current settings, requested selections, admission-only/rejected/unsent or conflicting observations do not. `RunnerWork` owns start confirmation independently of completion uncertainty: an admitted positive start still contributes history and current-presentation affinity when its outcome is unknown, without becoming success or reusable idle work. Both API and terminal origins use the same boundary. Observed modes accumulate without claiming that Runner can restore every previous process's work inventory.

Global history may consume retained and hidden observations. Tab affinity consumes only `presentedAttempts`, so an update to an earlier presentation cannot assign that attempt to a promoted UUID. An accepted requested-mode change takes precedence over starts already observed for the tab. A newer confirmed start for the current work owner can update affinity. A fresh process with no new start retains saved affinity.

Unified display always exposes one Runner domain and its add control. By-mode display groups visible tabs by supported affinity, using the common `runModeLabel` mapping and original protocol IDs. A domain's header and plus disappear when its final tab leaves, even when saved history contains that mode. With zero tabs, Single Entry and global Runner management remain available. A tab without supported affinity falls back to Task Run.

Domain-local add passes the domain's mode through the usual fresh or reused session allocation. `RunnerSessions` binds the new UUID to its own `HubSelections`, overriding only the requested mode before the tab appears. The request retains applicable defaults and any explicit Direct Root. Options can supply verified defaults to a new request while the domain mode stays selected. The add sends no configuration plan, apply or work submission. See [Runner session configuration](runner_session_config.md#draft-plan-and-apply) for the requested-settings and native configuration boundaries.

An accepted Run Mode edit in Task Settings updates that UUID's affinity before the settings commit can publish the new view. The same selected UUID appears immediately in the destination, including a previously absent domain. The session, terminal, composer draft and work remain with the tab. Rejected edits and passive options refreshes do not move it.

## Ordering and interaction

Drag/drop reorders only a domain's current UUID list. Sidebar renders the actual insertion line during mouse hover. Cross-domain drops, cancellation and stale captured membership/order are rejected and feedback is cleared. The display order never replaces UUID, creation order or native ownership. Domain lists share a flattened order with shortcut and post-removal selection consumers; Single Entry and termination-failure boundaries are retained. Management remains right-aligned; by-mode display omits the generic Runner heading/count. Each domain's full-width, 48px-high add button follows its last row, including an empty unified domain. The centered plus uses the original pale-green Light styling and dark-green Black styling with their respective hover colors.

## Evidence destinations and limits

`tests/e2e/navigation.spec.mjs` exercises production navigation/work and persistence contracts, delayed presentation updates, v1 compatibility, malformed metadata, write failure and stale reorder requests. `tests/e2e/runner-navigation.mjs`, registered by `runners.spec.mjs`, exercises production Hub/Sidebar with synthetic native responses. It covers empty domains, domain-local plus, the three allocation paths, immediate mode edits and ownership guards, along with ordering, reload, shortcuts and English/Korean Light/Black layouts. `runner-promotion.mjs` covers new-UUID attribution after hidden reuse. The browser fixtures exercise frontend behavior through the synthetic native boundary.
