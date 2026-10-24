# PRD

## Overview
- AgentRunnerHub is Novlito's desktop workspace for working with individual Agent Runners.
- This milestone delivers the application shell; real Runner connections belong to subsequent work groups.

## Goals
- Provide a single resizable desktop window with a Finder-inspired toolbar, left navigation, and spacious output workspace with a bottom instruction composer.
- Keep Single Entry first and fixed above the scrollable Runner list. Runner rows follow creation order, with a status icon and editable name on one line. Ellipsis affects display only.
- Selecting a context highlights its row and shows its own header and settings scope. Rename changes the local display name without changing Runner, project, or session identity.
- Offer separate Light and Black themes across the entire application, including navigation, controls, output, composer, borders, and interaction states.
- Keep the default application empty until real Runners are connected. Demonstration data belongs only in tests or previews.

## Non-Goals
- This milestone does not create processes, call Runner IPC, dispatch tasks, attach files, persist sessions, or implement session recovery or scheduling.
- Project, model, account, mode, command shortcuts, creation, dispatch, and attachment controls remain disabled and visibly not connected.
- Do not store progress state here.
- Do not store active project selection state here.
- Do not store deployed runtime state here.

## Usage
- Single Entry presents defaults reserved for future Runners. Changing these defaults must not implicitly change existing Runners.
- Individual Runner contexts have their own settings scope. Double-click a row name, use its rename action, or press F2 to edit; Enter saves, Escape cancels, and leaving the input saves a nonblank name.
- Theme selection applies immediately for the current application instance. No preference or session persistence is promised by this milestone.
- Preserve the Vite/React, Tauri 2, Desktop Terminal, Native I/O, Build System, and Windows/macOS CI foundations. Subsequent work groups connect real Runner processes and terminal streams.
