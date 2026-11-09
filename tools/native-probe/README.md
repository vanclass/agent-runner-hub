# Native Hub probe

## 문서 목적

실제 Hub 렌더러를 독립 Windows 테스트 프로세스로 검증하는 실행 방법을 설명한다.

## Run

From this checkout on Windows x64:

```text
npm ci
npm run test:native:probe
node --test tests/native/native-probe.test.mjs
node --test tests/native/lifecycle.test.mjs tests/native/platforms.test.mjs
```

The entry reuses installed Tauri environment preparation. Rust, MSVC, Windows SDK
and WebView2 must be available; missing privileged host prerequisites are reported
rather than installed by the test. The default WG2 probe and WG3 installation-entry
case need no Runner installation or credentials. Runner-backed cases require the
explicit isolated prerequisites below.
The default Cargo cache is `local/native-probe/target`. A shorter explicit cache is
available with `npm run test:native:probe -- --target-dir <absolute-directory>`.
Builds use the checkout lease; Ctrl+C requests cancellation and owned cleanup.
Do not distribute the debug test executable or use it with production data.

The entry prints an invocation directory under `temp/native-probe/`. It contains
case-specific directories containing `evidence.json` and, after successful displayed
renderer capture, `renderer.png`. These are
local reproduction artifacts retained for up to seven days for review; remove only
the selected settled invocation directory when no longer needed. The caller owns
that retention cleanup; no global sweeper is installed. Temporary native staging
and profiles are removed automatically after process settlement. Cargo caches are
reusable local build outputs. Unsettled cleanup is a failure and leaves resources
for the existing owner rather than attempting global process cleanup.

## Scope

[Native Tauri automation](../../docs/implementation_specs/native_automation.md)
owns the provider choice, test boundary, Windows observation/focus limitations,
macOS adapter and integration boundary. The original entry composes the renderer probe and an
independent language-preference case under node:test. It does not start Runner
sessions or exercise physical desktop input. The same entry selects the macOS
adapter on that host; Xcode Command Line Tools including swiftc and lsof are required.
Native macOS compilation, launch, focus behavior and cleanup are unverified here.

## Choose the evidence method

Choose from the acceptance property before execution. A failed check does not
authorize escalation to a displayed window or foreground control.

| Property | Least disruptive supported path | Evidence boundary |
| --- | --- | --- |
| React state, simulated transport, response/error handling | Headless Playwright | Synthetic Runner packets; no native authentication or OS input |
| Actual installation UI/resolver, native configuration and read-only response | WG3 background native cases | Real Tauri assets/IPC; Runner-backed claims require isolated prerequisites |
| Displayed renderer/theme/language | WG2 nonactivating cases | Owned rear window and screenshot; no trusted keyboard/mouse claim |
| Native correlation, handle isolation, cleanup/error contracts | Focused Rust/Node fixtures | Synthetic protocol children are not installed Runner acceptance |
| Focus-dependent terminal input, clipboard or OS dialogs | Existing authorized Computer Use | Requires its own target identity, readiness, input and settlement evidence |

Start with `npm ci` in this checkout. Browser preparation, if actually missing,
uses `npm run test:e2e:prepare`; it never requires manual DevTools interaction.

```text
npm run test:e2e -- runners.spec.mjs --grep "WG3 simulated|installation setup:"
npm run test:e2e -- session-config.spec.mjs hub-selection-initialization.spec.mjs
node --test tests/native/wg3.test.mjs tests/native/lifecycle.test.mjs tests/native/platforms.test.mjs tests/native/native-probe.test.mjs tests/native/hub-native.test.mjs
```

## Actual Hub cases and explicit selection

```text
node tools/native-probe/hub.mjs --help
node tools/native-probe/hub.mjs --case installation-entry
node tools/native-probe/hub.mjs --case renderer-probe --case language-preference
node tools/native-probe/hub.mjs --case configuration-selection --case runner-read-only --runner-root "D:/Codex/codex_workspace"
```

Repeat `--case` to compose only the required cases in one build; each still gets a
fresh owned process/profile. With no case selector, the three WG3 cases run.
`--target-dir <absolute Cargo cache>` works with either native entry.
Installation-entry checks mandatory setup, native rejection of a relative path,
unchanged saved installation and retry availability. Configuration-selection uses
the ordinary authenticated account's catalog to edit and persist a Hub draft without applying
it. Runner-read-only compares Hub selections and native inspection in the same
observed session/generation and verifies unchanged native revision.

## Existing Runner installation prerequisites

Supply `--runner-root` with the existing normally configured Runner workspace root.
The fresh application profile needs its own installation
selection; no user Hub profile is copied. The actual installation form/native
resolver verifies the managed runtime before the Hub session owner launches a new
Runner. Ordinary startup account authentication and `session_config.inspect` are
required; no saved Test account or second installation is needed. Missing authentication/capability
remains blocked; this command never provisions accounts, copies credentials,
injects startup authentication, adopts existing processes or submits model work.
Use the normally installed runtime, never an already-running Hub or Runner session.
If startup authentication or inspection is unavailable, retain the exact blocked
reason and complete independent installation/UI, fixture and headless checks.

Read-only instrumentation forwards callbacks unchanged. Native Tauri has immutable
`invoke`; its existing callback map exposes the Hub-created PTY event ID without
retaining terminal bytes. The case observes that exact session with `runner_observe`.
Synthetic fixtures use their writable invoke wrapper. Neither replaces responses.
Only `session_config.inspect` feature requests are issued by the case. Evidence retains
transport admission separately from the matching completed authoritative receipt;
neither proves work admission or work start, which are explicitly unexercised.
Account identity and credential paths are not copied into case observations.
Configuration-selection chooses verified account/model/run-mode options and changes
only the isolated Hub draft. Read-only comparison respects unbound UI selections
and compares current and effective settings according to their separate contracts.

## Rust and focus-required paths

```text
node tools/hub-native.mjs --help
node tools/hub-native.mjs test --test-filter session_config_tests
node tools/hub-native.mjs test --integration-test control_handles
```

These reuse managed host preparation, staged source and checkout build ownership.
The first selects library tests by Rust substring; the second selects one integration
target. Both accept `--target-dir <absolute Cargo cache>`. They do not enable ignored
installed-Runner tests or submit work. `control_handles` uses synthetic protocol
children: its native handle/cleanup evidence is distinct from real Runner replies.

The ignored exact native-handle roundtrip additionally needs a direct Python
interpreter. After the integration build, run its exact Cargo-reported test executable
with the standard Rust harness (PowerShell example); do not discover/adopt processes:

```powershell
$env:HUB_CONTROL_PYTHON = python -c "import sys; print(sys._base_executable)"
& '<exact control_handles executable printed by Cargo>' exact_handle_allowlist_authenticated_roundtrip_and_eof_uncertainty --exact --ignored --nocapture
Remove-Item Env:HUB_CONTROL_PYTHON
```

Preserve/restore a pre-existing environment value when applicable. This ignored test
authenticates only its synthetic protocol child, not an installed Runner or account.

For focus-required checks, use the existing Runner Computer Use tools after their
authorization and exact owned process/window readiness checks. There is no native
CLI flag that grants foreground input. Record observed effects and settle input
through that owner; do not use WebDriver focus/click fallbacks or manual DevTools.
Keep such checks unverified if the required ownership/capability is unavailable.
The tool sequence is `runner_computer_use.discover`, `acquire`, necessary `act`,
then `release` and `status` to confirm settlement, using each live tool's schema
and returned authorization/geometry. A pending desktop request uses that owner's
`desktop_wait`; no shell command substitutes for its authorization.

## Result interpretation

Read each case's `evidence.json`, not just command exit status. The suite fails any
non-pass case: `blocked` prerequisites, `unverified` observations/unknown transport
effects and assertion `failed` outcomes remain distinct in evidence. Unsupported
capability is a blocked reason, not a pass. Cleanup errors override success. A missing
completed receipt is unverified, never permission to resubmit. Driver deletion,
Hub close and Runner shutdown remain with their existing owners; no shared-process
cleanup is permitted. Windows native evidence applies only to the executed paths.
macOS source/fixture checks cannot prove native execution, focus or integration;
the existing Runner launch owner rejects macOS detached-child containment.

## Add or select a case

Export a `defineNativeCase` value from an application-owned module, then pass it
to `nativeSuite([myCase], { root, target })` from a node:test entry. The existing
`run.mjs` is the composition example. Use `node --test <your-entry.mjs>` for an
independent selection; there is no persistent test registry or automatic method fallback.
Use unique path-safe case IDs. `ready(browser)` owns bounded application readiness;
`run(browser)` owns assertions through existing runtime/DOM entry points.
For `presentation: 'nonactivating'`, provide `observe(browser)` for displayed checks.
For `presentation: 'background'`, the window stays hidden and no capture/display is requested.
The environment resets profiles between cases; do not depend on another case's state.

Window operations belong to the platform adapter. macOS displayed cases start
nonactivating at native Ready; Windows performs actions hidden before rear placement.
The evidence records that distinction. Missing capabilities, blocked prerequisites
and unverified observations are non-pass outcomes. Focus-required testing continues
to use the existing authorized Computer Use path; these callbacks authorize no input.
