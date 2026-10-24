# ARCHITECTURE

## Purpose
- AgentRunnerHub uses the existing Vite/React frontend inside the existing Tauri 2 desktop window.
- This document owns application responsibility boundaries and the separation between the UI shell and future Runner integrations.

## Systems
- Bootstrap: `src/main.ts` keeps the existing framework entry; `src/frameworks/react.tsx` mounts the Hub.
- Hub composition: `src/hub/Hub.tsx` owns local Runner view models, creation-order presentation, context selection, and display-name updates. Runner, project, and session IDs remain separate from editable names.
- Navigation: `src/hub/Sidebar.tsx` owns sidebar layout, row rendering, keyboard navigation, and temporary inline-edit drafts. Single Entry remains above the independently scrolling Runner list.
- Workspace: `src/hub/Workspace.tsx` owns the selected context header, scoped settings, output placeholder, and disabled bottom composer and attachment affordances.
- Theme: `src/hub/ThemePicker.tsx` selects application appearance; `src/hub/hub.css` defines Light and Black semantic tokens for every surface and interaction state. Selection is local to the current app instance.

## Boundaries
- Single Entry describes future Runner defaults. Individual Runner contexts describe only their own settings; no cross-context settings propagation is implemented.
- The shell uses a local view model and starts with no Runners or fabricated output. Controlled data is confined to `tests/fixtures`; no production fixture switch or session store is introduced.
- The existing Desktop Terminal, Native I/O, Tauri capabilities/backend, Build System, and desktop CI retain their current ownership. The shell does not invoke them to create Runner activity.
- Future work groups will own process creation and lifecycle, IPC, terminal stream connections, dispatch, attachments, and persistence. These are planned integration boundaries, not implemented shell capabilities.
- Preserve the existing native main window and resize behavior. The shell keeps navigation and composer accessible while the central output area scrolls independently.
- Do not store active project selection state here.

## Ownership
- Novlito owns the AgentRunnerHub product; `PRD.md` defines the product requirements.
- Frontend behavior and rendered theme/resize states are verified through the existing Playwright fixture in `tests/e2e/starter.spec.mjs` and `tests/e2e/hub.spec.mjs`.
- Browser rendering, TypeScript/Vite compilation, native-window observation, and Windows/macOS native build workflows provide separate evidence. None substitutes for an unavailable native-host check.
