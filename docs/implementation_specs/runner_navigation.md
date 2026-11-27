# Runner navigation presentation

## Ownership and storage

`src/hub/RunnerNavigation.ts` owns execution-mode history, per-tab display affinity and display-order operations. `Hub.tsx` composes one domain projection for Sidebar, numbered/adjacent shortcuts and selection after removal. `Sidebar.tsx` owns only transient drag input and insertion feedback. Native sessions, settings, drafts, unread state and work/recovery authority remain with their existing owners.

`RunnerWorkspace.ts` validates and serializes the optional presentation subrecord in its existing v1 envelope. It retains mode names, UUID display order and mode affinities for retained tabs, including well-formed unsupported mode names. Unknown names survive save without granting executable support. Known domains still restore, and a tab with unsupported affinity uses the Task Run presentation fallback. Creation order remains the stable naming/restoration identity. Missing or malformed navigation metadata loads empty while valid tab records restore. Malformed navigation produces a warning and a subsequent successful save writes valid metadata. Atomic save failure preserves the committed record and its warning and retry behavior. No work identity, generation, terminal data, credentials, draft or completion outcome is persisted.

App Settings stores the independent unified/by-mode choice through `HubPreferences.update`; absent v1 choices use unified display. Preference failure and concurrent-write protection remain under [Hub preferences](hub_preferences.md#independent-preference-storage).

## Execution history and domain affinity

`RunnerSessions` forwards already authenticated, validated `RunnerWork` observations. Only confirmed starts contribute modes; current settings, requested selections, admission-only/rejected/unsent or conflicting observations do not. `RunnerWork` owns start confirmation independently of completion uncertainty: an admitted positive start still contributes history and current-presentation affinity when its outcome is unknown, without becoming success or reusable idle work. Both API and terminal origins use the same boundary. Observed modes accumulate without claiming that Runner can restore every previous process's work inventory.

Global history may consume retained and hidden observations. Tab affinity consumes only `presentedAttempts`, so an update to an earlier presentation cannot assign that attempt to a promoted UUID. An accepted requested-mode change takes precedence over starts already observed for the tab. A newer confirmed start for the current work owner can update affinity. A fresh process with no new start retains saved affinity.

Unified display always exposes one Runner domain and its add control. By-mode display groups visible tabs by supported affinity, using the common `runModeLabel` mapping and original protocol IDs. A domain's header and plus disappear when its final tab leaves, even when saved history contains that mode. With zero tabs, Single Entry and global Runner management remain available. A tab without supported affinity falls back to Task Run.

Domain-local add passes the domain's mode through the usual fresh or reused session allocation. `RunnerSessions` binds the new UUID to its own `HubSelections`, overriding only the requested mode before the tab appears. The request retains applicable defaults and any explicit Direct Root. Options can supply verified defaults to a new request while the domain mode stays selected. The add sends no configuration plan, apply or work submission. See [Runner session configuration](runner_session_config.md#draft-plan-and-apply) for the requested-settings and native configuration boundaries.

An accepted Run Mode edit in Task Settings updates that UUID's affinity before the settings commit can publish the new view. The same selected UUID appears immediately in the destination, including a previously absent domain. The session, terminal, composer draft and work remain with the tab. Rejected edits and passive options refreshes do not move it.

## Ordering and interaction

Sidebar shows an insertion line before a row or at the end of the hovered list. RunnerNavigation verifies the captured UUID lists against the current source and destination membership and order, then checks the insertion anchor. Within one domain, including unified display, a drop writes only the presentation order. Shortcuts and selection after removal use the same flattened order.

Between visible run-mode domains, RunnerSessions resolves the dragged UUID's HubSelections, even when a different tab is selected. The drop uses the same editable, ready, catalog-supported mode boundary as Task Settings. HubSelections commits the requested mode through the existing tab-mode path and applies the prepared insertion order before subscribers see the change. The selected tab's panel immediately reflects its requested mode and fields. An unselected tab shows the new fields when opened, and the selected peer keeps its own settings. The last tab leaving a domain removes that section.

Rejection, cancellation and stale captures clear the insertion feedback without applying the drop. A successful move retains the UUID, selection, session, terminal, work and composer draft. Explicit Root and other requested choices stay with that UUID. Workspace and preferences restore the accepted placement, order and choices through their existing v1 records. Dragging issues no native configuration plan, apply or work submission.

Management remains right-aligned, and by-mode display omits the generic Runner heading/count. Each domain's full-width, 48px-high add button follows its last row, including an empty unified domain. The centered plus uses the original pale-green Light styling and dark-green Black styling with their respective hover colors.

## Evidence destinations and limits

`tests/e2e/navigation.spec.mjs` exercises production navigation/work and persistence contracts, delayed presentation updates, v1 compatibility, malformed metadata, write failure and stale source or destination captures. `tests/e2e/runner-navigation.mjs`, registered by `runners.spec.mjs`, exercises production Hub/Sidebar using pointer events with synthetic native responses. It covers both insertion paths, selected and unselected moves, cancellation, settings and ownership guards, reload, shortcuts, domain-local allocation and English/Korean Light/Black layouts. `runner-promotion.mjs` covers new-UUID attribution after hidden reuse.
