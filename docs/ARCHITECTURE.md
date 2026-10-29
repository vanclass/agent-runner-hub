# ARCHITECTURE

## Purpose
- AgentRunnerHub uses the existing Vite/React frontend inside the existing Tauri 2 desktop window.
- This document owns application responsibility boundaries between the UI shell, native terminal sessions and authenticated Runner control.

## Systems
- Bootstrap: `index.html` loads project-owned `src/hub/entry.tsx`, which mounts the Hub with StrictMode and HMR unmount cleanup. `src/main.ts` and `src/frameworks/react.tsx` retain Runner-managed framework integration independently of the Hub entry.
- Hub composition: `src/hub/Hub.tsx` composes installation configuration and the session registry, owns context selection, and routes display-name updates. Stable identities remain separate from editable names.
- Navigation: `src/hub/Sidebar.tsx` owns sidebar layout, row rendering, keyboard navigation, and temporary inline-edit drafts. Single Entry remains above the independently scrolling Runner list.
- Workspace: `src/hub/Workspace.tsx` composes the selected context header, scoped settings, terminal view and instruction composer. `RunnerSessions.ts` owns terminal resources independently of workspace mounting; details belong to the [terminal specification](implementation_specs/runner_terminals.md).
- Theme: `src/hub/ThemePicker.tsx` selects application appearance; `src/hub/hub.css` defines Light and Black semantic tokens for every surface and interaction state. Language and theme choices are restored by the independent [Hub preferences boundary](implementation_specs/hub_preferences.md); `i18n.ts` owns localized presentation.

## Boundaries
- Single Entry owns assignment defaults independently of each Runner's settings. Its assignment component composes the existing session registry, authenticated control and input owners; the [terminal specification](implementation_specs/runner_terminals.md#single-entry-assignment) defines the evidence and delivery boundaries.
- A new workspace starts with no Runners or fabricated output. Saved tab metadata is validated before restoring fresh owned sessions. Controlled data and transport simulations are confined to tests; there is no production fixture switch.
- Runner sessions reuse the installed Desktop Terminal bridge, xterm dependencies, portable-pty backend, and shared Tauri builder. The application-owned native backend adds installation verification and Runner containment; managed launch/build configuration and Native I/O remain intact.
- Runner control belongs to each native session. The frontend consumes allowlisted observations and requests existing terminal-owned commands; the [terminal specification](implementation_specs/runner_terminals.md#local-control-and-reference-boundaries) owns the detailed contract and unsupported attachment/media boundaries.
- `RunnerWorkspace.ts` owns local tab persistence; `RunnerSessions.ts` composes restoration through native launch, and `RunnerRecovery.tsx` exposes Runner-owned recovery. Saved identities convey context without process or continuation authority; the [terminal specification](implementation_specs/runner_terminals.md#durable-workspace-and-recovery) owns that contract. Scheduling remains outside the assignment boundary.
- Preserve the existing native main window and resize behavior. The shell keeps navigation and composer accessible while the central output area scrolls independently.
- Do not store active project selection state here.

## Ownership
- Novlito owns the AgentRunnerHub product; `PRD.md` defines the product requirements.
- Frontend behavior and rendered theme/resize states use the existing Playwright fixture in `tests/e2e/starter.spec.mjs`, `tests/e2e/hub.spec.mjs`, and `tests/e2e/runners.spec.mjs`. The [terminal specification](implementation_specs/runner_terminals.md) routes native and installed-Runner checks.
- Browser rendering, TypeScript/Vite compilation, native-window observation, and Windows/macOS native build workflows provide separate evidence. None substitutes for an unavailable native-host check.
