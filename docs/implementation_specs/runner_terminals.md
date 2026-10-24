# Runner terminal ownership

## Session lifetime and identity

`src/hub/RunnerSessions.ts` owns each Runner's terminal, PTY connection, input ordering, output parser, scrollback, draft, and observed process state. `Hub.tsx` owns selection and composes the views. A keyed `Workspace.tsx` can unmount: `RunnerTerminal.tsx` only detaches its geometry observer. Selecting the tab reattaches the same xterm element and fits that existing terminal. Inactive terminals continue parsing and acknowledging output; selection never launches or closes a process.

Names are local display labels. The row identity and its native PTY identity remain stable when renamed. Rows retain creation order, and Single Entry remains above their independently scrolling list. Only the configured installation location is persisted; Runner tabs, terminal buffers, and drafts are process-local.

Composer drafts and pending submission belong to the session snapshot. Switching views during a pending PTY write preserves its disabled/busy state and cannot submit the same draft again; successful delivery clears that session's draft.

## Native launch and shutdown

`src-tauri/src/desktop_terminal/runner.rs` accepts an installed workspace or its `agent_runner` folder. It verifies that the managed Python environment imports that installation's exact Runner source, then directly launches `python -I -m runner run --repo-root <workspace>` there with the retained backend. Shell aliases are not executables. Invocation-scoped Runner coordination variables and Python path overrides are removed from the launch environment. Runner source, environments, credentials and runtime data stay in the configured installation.

On Windows, verification still uses the canonical filesystem identity, while returned DOS/UNC installation paths use ordinary external argument spelling. This prevents verbatim canonicalization prefixes from creating a mismatch with paths reported by Runner's App Server. Other device path kinds retain their original spelling.

The existing Desktop Terminal bridge and native `Sessions` registry remain the PTY backend. Windows Runner sessions use a separate non-inheritable Job Object with kill-on-close and no breakaway permission. The checksum-verified public portable-pty 0.9 source under `src-tauri/vendor/portable-pty` has a narrow extension for the Windows JOB_LIST startup attribute alongside ConPTY. Assignment occurs before Python executes; assigning an already running child would leave a descendant-creation race. The Hub remains outside those per-Runner jobs.

Explicit termination, natural root exit, native window destruction, and final native ownership cleanup settle the owned job. Job termination waits for its active process count to reach zero. Natural exit is published after residual descendant cleanup and terminal output drainage. Unrelated PTY sessions and unrelated processes are outside that job. The generic Desktop Terminal request retains its original direct-child behavior.

macOS installation resolution is implemented, but Runner launch is gated before process creation: initial POSIX process groups cannot contain Runner children that start another session. A supported detached-descendant shutdown boundary is still required. macOS native compilation and interaction need matching host evidence.

The vendored Unix cloned killer sends SIGHUP to the direct child PID. Neither this operation nor killing the initial process group establishes detached-descendant containment. The existing Runner's POSIX group cleanup and cooperative shutdown are insufficient evidence to remove the macOS launch gate; a matching native detached-descendant fixture and installed-Runner acceptance remain required. A launchd job's process-group cleanup must not be treated as equivalent to a Windows Job Object.

## Native executable build entry

`tools/hub-native.mjs` composes the installed Tauri host preparation, checkout build lease, backend staging and desktop feature selection. Its explicit absolute Cargo target directory allows Windows callers to select a short real output/cache path while frontend and backend staging remain checkout-local. It does not change managed build tooling, Runner installations, original Cargo locks or previous frontend output. `--help` describes build and native test commands; Cargo owns the selected output cache.

The standalone build passes a relative frontend directory to Tauri so Windows drive letters cannot be interpreted as URL schemes. The ordinary Tauri CLI enables production asset serving even for this debug executable; no test runtime branch or additional Cargo feature is used. The standalone build is distinct from Build System packaging and native development. A successful build establishes compilation and executable availability; GUI interaction, process cleanup and installer acceptance require their own observations. Build System remains the packaged-product owner.

## Input and process observations

`runnerInput.ts` honors the Win32 input mode requested through ConPTY. Physical keys retain their virtual key and modifiers; the composer encodes Unicode as UTF-16 key records and embedded line breaks as Shift+Enter, followed by one ordinary Enter. On standard VT terminals, the composer uses the negotiated bracketed-paste protocol and a separate Enter. Terminal responses and binary input retain their protocol bytes. The composer appends to any existing terminal draft; it does not replace Runner's own editor or interpret commands.

The UI reports starting, successful process launch, launch failure, and observed exit/code or transport errors. Terminal text never establishes task readiness, work completion, or assignment state. Launch and unexpected-exit failures affect only that session. Attachments, control IPC, automatic work assignment, scheduling, crash recovery, and restored sessions remain outside this integration.

## Source and checks

- Frontend/session integration: `src/hub/RunnerSessions.ts`, `runnerInput.ts`, `RunnerTerminal.tsx`, `RunnerComposer.tsx`, and `RunnerLocation.tsx`; controlled transport and actual xterm rendering checks in `tests/e2e/runners.spec.mjs`.
- Navigation, renaming, themes and resizing: `tests/e2e/hub.spec.mjs` and `tests/e2e/starter.spec.mjs` through the installed Playwright fixture.
- Native launch, PTY and job ownership: `src-tauri/src/desktop_terminal.rs` and `src-tauri/src/desktop_terminal/{pty,runner,job,process}.rs`; focused Rust tests in `desktop_terminal/tests.rs` and the resolver/startup modules.
- Installed Runner acceptance tests are explicitly ignored by ordinary CI and require `HUB_RUNNER_ACCEPTANCE_ROOT` on Windows. They exercise actual commands, Unicode/multiline input, resize, normal exit, separate sessions, individual termination, window-owner cleanup, and an unrelated fixture's survival. Fixture, installed-Runner, actual native-window, and hosted CI results are distinct evidence.
