# Native Hub probe

## 문서 목적

실제 Hub 렌더러를 독립 Windows 테스트 프로세스로 검증하는 실행 방법을 설명한다.

## Run

From this checkout on Windows x64:

```text
npm ci
npm run test:native:probe
node --test tests/native/native-probe.test.mjs
```

The entry reuses installed Tauri environment preparation. Rust, MSVC, Windows SDK
and WebView2 must be available; missing privileged host prerequisites are reported
rather than installed by the test. No Runner installation or credentials are needed.
The default Cargo cache is `local/native-probe/target`. A shorter explicit cache is
available with `npm run test:native:probe -- --target-dir <absolute-directory>`.
Builds use the checkout lease; Ctrl+C requests cancellation and owned cleanup.
Do not distribute the debug test executable or use it with production data.

The entry prints an invocation directory under `temp/native-probe/`. It contains
`evidence.json` and, after successful renderer capture, `renderer.png`. These are
local reproduction artifacts retained for up to seven days for review; remove only
the selected settled invocation directory when no longer needed. The caller owns
that retention cleanup; no global sweeper is installed. Temporary native staging
and profiles are removed automatically after process settlement. Cargo caches are
reusable local build outputs. Unsettled cleanup is a failure and leaves resources
for the existing owner rather than attempting global process cleanup.

## Scope

[Native Tauri automation](../../docs/implementation_specs/native_automation.md)
owns the provider choice, test boundary, Windows observation/focus limitations,
macOS configuration and follow-up boundary. This entry does not run feature suites,
start Runner sessions or exercise physical desktop input. macOS native execution
is unavailable through the Windows process adapter.
