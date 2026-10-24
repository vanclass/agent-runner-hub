# Desktop Terminal

## 문서 목적

선택형 React 터미널의 사용 방법과 PTY 소유권 및 검증 범위를 설명합니다.

## Selection and usage

Select Web App → Frameworks → React, Runtimes → Tauri 2, then Tools → Desktop Terminal and Review/Apply. It defaults to Off. Use the normal `npm run dev:tauri` or selected Tauri root launcher. Browser preview and Android do not provide PTYs.

From an application module under `src`, import:

```tsx
import { DesktopTerminal } from '../.runner/web-app-desktop/terminal/DesktopTerminal';

export function Terminals() {
  return <><DesktopTerminal /><DesktopTerminal /></>;
}
```

Each mounted component owns a separate PTY. Optional `request` supplies a program, argument array, working directory and environment. Keep request objects and `onExit` callbacks stable with React memoization to retain the instance across parent renders. Copy examples into user-owned source before customizing them; managed file changes intentionally block updates/removal instead of overwriting custom work.

The small typed `bridge.ts` exposes open, write, resize and close. Input strings use UTF-8; xterm binary input uses raw byte values. Output remains bytes, so split Unicode sequences and ANSI escapes reach xterm intact. The reader waits for xterm's write callback acknowledgement, bounding unconsumed output. Fit observes container geometry; Search is independent for each component.

## Native integration and lifecycle

The existing Tauri runtime owns Cargo features and the shared Rust builder. Desktop Terminal selects `desktop-terminal` only in desktop staging after desired/applied selection agrees. Its backend is compiled out by default and on Android. Custom backends require an explicitly compatible feature/module/builder integration; Apply preserves them and reports incompatibility.

Creation, writes, resize and termination run outside the WebView event loop. Commands enforce invoking-window ownership; creation is limited to the main window. Natural process exit follows output drain. Explicit close/unmount/window destruction requests termination and releases the owned PTY; output after explicit close may be discarded. Close acknowledgement means termination was requested; the exit callback observes actual reaping and reader completion.

Pending creation is registered before worker dispatch so a destroyed window cannot publish a late session. The native Windows reader answers only ConPTY's initial inherited-cursor query for a blank terminal; subsequent terminal queries reach xterm normally. This keeps startup and output drainage independent of a mounted renderer. The Windows adapter uses a duplicated child process handle with checked termination because portable-pty 0.9 reverses that API's success result. An underlying OS creation call must settle before its worker can finish cleanup; cancellation does not forcibly abort that call.

`portable-pty` uses Windows ConPTY and macOS PTYs. Its killer targets the direct child; it does not guarantee termination of detached grandchildren. Applications needing detached-process supervision own that separate policy. GUI-launched macOS applications have a limited PATH: use an absolute program path or explicitly request a login shell where appropriate.

## Checks and limits

Run `node .runner/web-app-tauri/check.mjs` for staged Cargo checks and tests of selected features. The generated crate also supports ordinary `cargo test --manifest-path src-tauri/Cargo.toml --features desktop-terminal`. Tests create their own processes and cover Unicode, input, resize calls, separate instances, natural exit and termination with unacknowledged output.

Native GUI keyboard/paste/rendering, macOS PTYs and macOS cancellation need matching native-host evidence. A frontend build or controlled transport test does not establish those observations. Windows MSVC requires sufficiently short checkout, Rust-home and output paths; deep task paths can exceed linker limits.
