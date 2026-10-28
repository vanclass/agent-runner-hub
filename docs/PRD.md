# PRD

## Overview
- AgentRunnerHub is Novlito's desktop workspace for working with individual Agent Runners.
- The application shell supports manually created native Runner terminal connections. Cross-platform shutdown support remains an acceptance requirement; current platform limits are documented in the [terminal specification](implementation_specs/runner_terminals.md).

## Goals
- Provide a single resizable desktop window with a Finder-inspired toolbar, left navigation, and spacious output workspace with a bottom instruction composer.
- Keep Single Entry first and fixed above the scrollable Runner list. Runner rows follow creation order, with a status icon and editable name on one line. Ellipsis affects display only.
- Selecting a context highlights its row and shows its own header and settings scope. Rename changes the local display name without changing Runner, project, or session identity.
- Offer separate Light and Black themes across the entire application, including navigation, controls, output, composer, borders, and interaction states.
- Keep a new workspace empty until real Runners are connected. Reopening restores saved tab identities and order with fresh owned Runner processes; historical work requires Runner-owned recovery. Demonstration data belongs only in tests or previews.
- Let users configure an installed Runner, create independent Runner tabs, interact with their actual terminals, and terminate one without disturbing the others. Tab selection must preserve execution, output and geometry; normal shutdown must settle Hub-owned processes.

## Non-Goals
- This integration does not confirm attachment delivery, reconnect to old processes, replay instructions, or implement scheduling. Durable tab restoration and Runner-owned historical recovery follow the [terminal specification](implementation_specs/runner_terminals.md#durable-workspace-and-recovery).
- Single Entry assigns once to a verified eligible Runner or creates one through the owned launch path. Unsupported default changes require Runner terminal interaction and leave instructions unsent. Reference selection alone must not imply registration.
- Do not store progress state here.
- Do not store active project selection state here.
- Do not store deployed runtime state here.

## Usage
- Single Entry presents assignment defaults from verified Runner observations. Changing these defaults must not implicitly change existing Runners; [assignment boundaries](implementation_specs/runner_terminals.md#single-entry-assignment) govern reuse, readiness and delivery uncertainty.
- Individual Runner contexts have their own settings scope. Double-click a row name, use its rename action, or press F2 to edit; Enter saves, Escape cancels, and leaving the input saves a nonblank name.
- Language (English/Korean) and Light/Black theme selection apply immediately and restore on startup. Safe user-selected Single Entry defaults are saved separately and revalidated; [Hub preferences](implementation_specs/hub_preferences.md) defines that boundary. Installation and tab metadata keep their existing contracts; terminal buffers, composer input and pending submissions remain process-local.
- Preserve the Vite/React, Tauri 2, Desktop Terminal, Native I/O, Build System, and Windows/macOS CI foundations. Verify a local installation in Single Entry, then use the green + action at the end of the Runner list. Installation and Direct Root fields also accept native folder browsing before explicit verification or configuration actions; process and platform boundaries are described in the [terminal specification](implementation_specs/runner_terminals.md).
