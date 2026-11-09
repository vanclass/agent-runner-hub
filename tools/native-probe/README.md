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
rather than installed by the test. No Runner installation or credentials are needed.
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
macOS adapter and follow-up boundary. The entry composes the renderer probe and an
independent language-preference case under node:test. It does not start Runner
sessions or exercise physical desktop input. The same entry selects the macOS
adapter on that host; Xcode Command Line Tools including swiftc and lsof are required.
Native macOS compilation, launch, focus behavior and cleanup are unverified here.

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
