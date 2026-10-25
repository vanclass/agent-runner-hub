# PRD

## Overview
- AgentRunnerHub is Novlito's desktop workspace for working with individual Agent Runners.
- The application shell supports manually created native Runner terminal connections. Cross-platform shutdown support remains an acceptance requirement; current platform limits are documented in the [terminal specification](implementation_specs/runner_terminals.md).

## Goals
- Provide a single resizable desktop window with a Finder-inspired toolbar, left navigation, and spacious output workspace with a bottom instruction composer.
- Keep Single Entry first and fixed above the scrollable Runner list. Runner rows follow creation order, with a status icon and editable name on one line. Ellipsis affects display only.
- Selecting a context highlights its row and shows its own header and settings scope. Rename changes the local display name without changing Runner, project, or session identity.
- Offer separate Light and Black themes across the entire application, including navigation, controls, output, composer, borders, and interaction states.
- Keep the default application empty until real Runners are connected. Demonstration data belongs only in tests or previews.
- Let users configure an installed Runner, create independent Runner tabs, interact with their actual terminals, and terminate one without disturbing the others. Tab selection must preserve execution, output and geometry; normal shutdown must settle Hub-owned processes.

## Non-Goals
- This integration does not assign work automatically, confirm attachment delivery, persist sessions, or implement crash recovery or scheduling. Supported per-Runner settings and command interactions use authenticated local control within the [terminal specification](implementation_specs/runner_terminals.md#local-control-and-reference-boundaries).
- Single Entry default-setting automation and automatic dispatch remain unavailable. Reference selection alone must not imply registration. The connected instruction composer submits through the selected terminal's actual input semantics.
- Do not store progress state here.
- Do not store active project selection state here.
- Do not store deployed runtime state here.

## Usage
- Single Entry presents defaults reserved for future Runners. Changing these defaults must not implicitly change existing Runners.
- Individual Runner contexts have their own settings scope. Double-click a row name, use its rename action, or press F2 to edit; Enter saves, Escape cancels, and leaving the input saves a nonblank name.
- Theme selection applies immediately for the current application instance. Only the installation location is saved; tab sessions and theme selection are local to the current Hub instance.
- Preserve the Vite/React, Tauri 2, Desktop Terminal, Native I/O, Build System, and Windows/macOS CI foundations. Verify a local installation in Single Entry, then use New Runner; process and platform boundaries are described in the [terminal specification](implementation_specs/runner_terminals.md).
