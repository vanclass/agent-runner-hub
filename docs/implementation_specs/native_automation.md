# Native Tauri automation

## Test build and driver boundary

The project-owned standalone entry is `npm run test:native:probe`, implemented by
[`tools/native-probe/run.mjs`](../../tools/native-probe/run.mjs). It supplements the
managed headless Playwright entry and existing Rust acceptance paths; it does not
replace their fixtures, schedule suites or authorize desktop input.

## Reusable environment and cases

[`suite.mjs`](../../tools/native-probe/suite.mjs) composes explicit case definitions
under `node:test`. [`case.mjs`](../../tools/native-probe/case.mjs) defines the stable
contract: path-safe `id`, explicit `background` or `nonactivating` presentation,
`ready(browser)`, `run(browser)` and a displayed-case `observe(browser)` assertion.
Cases own application readiness and feature assertions; they contain no OS window
operations. Adding a case changes composition, never a feature branch in the executor.

[`environment.mjs`](../../tools/native-probe/environment.mjs) builds once per suite,
starts a new process with cleared invocation-owned profile directories for each case,
and retains staging until suite teardown. [`lifecycle.mjs`](../../tools/native-probe/lifecycle.mjs)
orders process/listener readiness, driver connection, case readiness/actions,
presentation/observation and driver/process/profile settlement. Driver configuration
belongs to [`driver.mjs`](../../tools/native-probe/driver.mjs); native evidence checks
belong to [`observations.mjs`](../../tools/native-probe/observations.mjs).

Each case records its identity, invocation, host, architecture, presentation and
observations independently. Prerequisite blocks, failures and unverified observations
are distinct outcomes; cleanup failures prevent a pass. The suite cannot continue
with another process when a prior owned process has not settled.

The probe reuses managed environment preparation, checkout build ownership, native
staging and applied desktop features through [`build.mjs`](../../tools/native-probe/build.mjs).
Only staged configuration receives [`tauri.test.json`](../../tests/native/webdriver/tauri.test.json),
embedded frontend assets, isolated application directories and the nondefault
`native-webdriver` Cargo feature. Original configuration, Cargo lock resolution
behavior and ordinary build entry points remain unchanged. The staged lock is used
with `--locked`; the existing native infrastructure resolves it per invocation.

[`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) registers the optional
`tauri-plugin-wdio-webdriver` only for supported desktop test builds. Release builds
reject the feature. Test startup requires an explicit nonzero port, application
directory override and hidden, unfocused, unfocusable windows. Ordinary builds do
not compile/register the optional server. The probe checks the ordinary active
dependency graph and compiles the ordinary library without the feature.

The published `@wdio/tauri-service` 1.5.1 embedded provider was evaluated against
Tauri 2.12.2 / tauri-build 2.7.1. Its embedded Rust plugin 1.5.1 and standalone
WebdriverIO 9.31.9 client are used directly: the probe owns process creation rather
than handing it to the service launcher, whose environment merge/logging would
require additional isolation. No frontend WDIO extension, `withGlobalTauri`,
`wdio:default` permission grant or production IPC command is added. The embedded
plugin's default permission set is empty; HTTP script execution is unauthenticated
and is secured here by test-only compilation and local runtime isolation, not ACLs.

## Windows process, window and observation

[`owner.mjs`](../../tools/native-probe/owner.mjs) selects a platform adapter;
[`protocol.mjs`](../../tools/native-probe/protocol.mjs) owns its stdio session.
The [Windows adapter](../../tools/native-probe/platforms/windows.mjs) starts hidden PowerShell
with an environment allowlist. Application/WebView profile, user directories and
scratch are invocation-owned; inherited Runner credentials and WebView debugging
arguments are excluded. The adapter launches the test executable and retains its
original process handle. Window discovery additionally matches the test main-window
title. It never adopts an existing Hub/Runner or changes a user-owned window.

Before HTTP connection, the adapter verifies the exact owned process exposes only
the selected `127.0.0.1` listener. Port reservation is released before launch; a race
fails ownership verification instead of adopting another listener. Startup, driver
connection and actual renderer readiness are separate checks.

The main window starts hidden and unfocusable. After a hidden DOM observation/action,
Windows `SetWindowPos` places only that HWND on the primary monitor at `HWND_BOTTOM`
with `SWP_NOACTIVATE`, `SWP_SHOWWINDOW` and `SWP_NOOWNERZORDER`. The probe verifies
visibility, stable HWND and that the foreground window is above it. Foreground PIDs
are sampled from before process creation through teardown; checkpoints also record
the foreground HWND. Sampling can miss shorter activation transients and is not a
universal no-activation guarantee across hosts. No foreground restoration is attempted.

[`probe.mjs`](../../tests/native/webdriver/probe.mjs) observes the actual native asset
origin, Tauri runtime, installation dialog and fresh profile. A scripted DOM click
runs the real React theme handler; DOM state, pressed state and persisted preference
must agree. A renderer screenshot and visible DOM check follow nonactivating display.
This establishes background DOM and displayed nonactivating observation for the
exercised path. Scripted DOM events do not prove trusted keyboard/mouse input,
terminal routing, clipboard, OS dialogs or focus-required feature acceptance.

[`language.mjs`](../../tests/native/webdriver/language.mjs) independently exercises
the language selector's React handler, document language and persisted preference,
then observes those values after nonactivating display through the same lifecycle.
Windows cases start hidden; background cases never display a native window.

Session deletion precedes native close. The Windows adapter sends `WM_CLOSE` only
to its process-owned main HWND, waits, and uses its retained process handle only if
forced cleanup is necessary. Forced exit is not a passing probe. Listener release
and removal of invocation profiles/staging are checked after process settlement.
Unsettled ownership prevents data cleanup. No process-name/tree-wide cleanup is used.

## Platform and follow-up boundaries

Windows uses WebView2 and the installed MSVC/SDK/Rust preparation. The same optional
embedded plugin supports macOS WKWebView without SafariDriver, external tauri-driver
or a service key. The build adapter selects the native macOS triple and a test-only
incognito store; the Rust test boundary remains shared. Xcode Command Line Tools
and Rust are prerequisites. The [macOS adapter](../../tools/native-probe/platforms/macos.mjs)
compiles its Swift owner with Xcode tools. It launches the exact executable using
`posix_spawn` and an allowlisted environment, isolated HOME/application paths and
incognito WebKit storage. The owner serializes signaling and `waitpid` for the original
unreaped child; it never adopts a discovered PID or signals after reaping.

The existing debug-only feature includes [macOS startup ordering](../../src-tauri/src/native_automation_macos.rs).
Tauri startup respects the active application. The window stays hidden through Tao's
launch hook; at Ready, an explicitly displayed case uses main-thread `NSWindow.orderBack`,
never Tauri show/focus. Background cases remain hidden. This is a startup presentation
choice, not a runtime command or privileged test API. The case evidence records whether
actions began hidden or already nonactivating; a displayed window cannot satisfy a
background case. A current foreground application is required before launch.

The Swift owner observes AppKit activation notifications and CoreGraphics window
ordering. Public `lsof` process/file records gate HTTP on the selected literal IPv4
loopback listener. Missing observation/placement capability fails explicitly, without
Accessibility, input, user-window changes or an activation fallback. Ordering is
level/Space-dependent and must be checked on the actual host.

After driver deletion, macOS requests normal quit on the retained owned
`NSRunningApplication`, waits/reaps, and checks listener release before profile cleanup.
This is application quit, not Windows WM_CLOSE equivalence; it adds no window-close
test endpoint. Forced exact-child cleanup cannot pass. The existing application
session owner retains its shutdown responsibility. macOS compilation, launch,
persistence isolation, foreground behavior and native runtime acceptance remain
unverified until exercised on macOS; Windows fixture/source checks cannot establish them.

The evaluated bounded Windows alternative is existing Playwright 1.56.1 over an
owned WebView2 CDP endpoint with a unique profile and verified loopback listener.
It has lower protocol fidelity and no stronger nonactivation guarantee. It was not
needed or implemented because the embedded provider exercised the required renderer.

WG2 supplies the reusable environment and independently composed renderer/language cases.
Focus-required/native input needs its own evidence and existing authorization owner;
this foundation adds no desktop authorization, fallback chain, selection registry or
universal scheduler. Runner-integrated feature and operating-workflow acceptance remain WG3.

## Evidence and operation

Use [`tools/native-probe/README.md`](../../tools/native-probe/README.md) for commands
and artifact retention. Focused environment/failed-launch checks live in
[`tests/native/native-probe.test.mjs`](../../tests/native/native-probe.test.mjs).
Per-run renderer, visibility, foreground, listener and teardown observations belong
to the invocation evidence and task report, not this specification.

Provider source references: [published setup](https://unpkg.com/@wdio/tauri-service@1.5.1/docs/plugin-setup.md),
[plugin manifest](https://docs.rs/crate/tauri-plugin-wdio-webdriver/1.5.1/source/Cargo.toml.orig),
[loopback server](https://docs.rs/crate/tauri-plugin-wdio-webdriver/1.5.1/source/src/server/mod.rs),
[service configuration](https://unpkg.com/@wdio/tauri-service@1.5.1/docs/configuration.md),
[SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos).
