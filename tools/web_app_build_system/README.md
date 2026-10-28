# Web App Build System

## 문서 목적

선택형 웹 앱 빌드 도구의 실행, 환경 준비, 결과물 및 확장 경계를 안내한다.

## Run and prepare

Select Web App → Tools → Web App Build System in New, Link Existing or Project Settings.
It is Off by default. Apply deploys this package and project-root build.cmd, build.sh and
build.command. Open the root entry from any directory. This installed package uses
Node/npm and the project's dependencies; Runner and the Codex workspace are unnecessary.
On Windows, build.cmd also uses the installed .NET Framework C# compiler for a temporary
console bridge. Its executable is removed after the Node process exits. The bridge restores
the caller's cursor, console modes and output code page, including cancellation and errors.
Menu sizing follows the visible console window even when its backing buffer is wider.

The menu separates Build Ready, Environment Preparation Required, Runtime Selection Required, Native Verification
Unavailable and Not Implemented, with readiness and verification shown under each target.
Each registered implemented target has its own number, stable across readiness changes.
Use Up/Down to select, its number / Enter to build, P to prepare that target only, or
B / Q / Esc to leave. After success, failure or cancellation the selected target retains focus.
Interactive navigation replaces changed rows in a bounded viewport; resize keeps the logical
selection visible. Build logs remain in console history while transient menu rows are reused.
Web remains target 1 and the default selection, labeled Vite or Astro from the applied Foundation; Windows/Tauri is target 2 when selected.
Ctrl+C cancels an active build/preparation; an interrupted install may need Prepare again.
Windows cmd may ask its own batch confirmation after an interrupted session exits; the tool has already released its build lease before returning to the menu.
Redirected input accepts numbers, target IDs, Enter, Up/Down, P, Back/exit/cancel and exits on EOF.

For automation, pass --list, --build web, --build web --prepare, or --prepare web to the root entry.
Windows/Tauri requires both Runtimes/Tauri2 and this Tool selected and applied. Without the
runtime, its unavailable entry explains selection and tool requirements. Android/Tauri uses
the same applied runtime/Tool selections. Windows/Electron requires Electron and this Tool selected and applied.
Tauri and Electron selections are independent; Web executes independently of both runtimes. Astro supports only the browser target.
Use --prepare windows-tauri or --build windows-tauri --prepare for the native target.

Install compatible Node.js with npm on PATH (Node 20.19+ or 22.12+; project/package engine
requirements also apply). Node/npm upgrades, privileged OS tooling and registry/authentication
blockers require external user action. The tool never silently claims those were prepared.
Supported preparation uses npm ci with an existing lockfile, otherwise npm install,
including development and optional dependencies. It rechecks installed declarations and
exact lockfile versions and reuses compatible dependencies. Inconsistent package/lock
declarations must be resolved by the project owner.

## macOS / Tauri 2

Select Tauri 2 and Build System, then run `./build.command --build macos-tauri --prepare`.
`--prepare macos-tauri` only prepares; `--build macos-tauri` requires a ready environment.
The target reuses existing staging, cancellation and immutable result publication. Native
Apple Silicon and Intel hosts select aarch64-apple-darwin and x86_64-apple-darwin respectively.
Xcode Command Line Tools, matching Rust >=1.90 and compatible Node/npm are required.
Permitted preparation reuses installed tools and adds missing rustup targets/local CLI.

Products contain `.app`, `.dmg` and products.json. Verification checks app identity/version,
Mach-O CPU/executable shape, executable permission, disk-image integrity and stable inputs.
The pinned CLI packages with `--no-sign`; signing, notarization, installation, Gatekeeper
and GUI execution remain unverified. macOS packaging cannot run on Windows/Linux. Both
architectures require their own native-host acceptance. Apple credentials are outside this tool.

## Windows / Electron

Use --prepare windows-electron, --build windows-electron, or --build windows-electron --prepare.
The adapter requires Windows x64 and compatible Node/npm; the packaging recipe declares the
Forge Node requirement. Prepare reuses compatible Electron Chromium, startup and Forge/Squirrel
dependencies or installs missing tools in ignored checkout-local packages. It preserves root
package settings and lockfiles. Disabled installation, package-script restrictions, download/
network errors, write permissions and external native-module Python/MSVC/SDK needs are reported
with retry guidance. No privileged installers or policy changes run automatically.

Electron Forge with Squirrel.Windows creates a complete application directory, Setup.exe,
full NuGet package and RELEASES. Installer metadata comes from Electron app-config.json and
explicit root package settings; name, productName, author, description and a stable numeric
project version are required. Root metadata is never rewritten. The staged native workspace
uses a private short host-temporary path for Squirrel's .NET path limit, and is always removed;
verified products still publish only through the immutable checkout-local result owner.

Verification checks the exact executable/installer identities, PE shape, Chromium support
files, staged package/main/preload/startup metadata, NuGet CRC/content and RELEASES SHA-1/size,
product hashes and unchanged frontend/runtime/packaging inputs. products.json distinguishes
verified bytes from signing, native GUI and installer execution. Real Windows packaging and
an isolated development window were exercised; installer installation/uninstallation, shortcuts,
signing and custom native modules remain separate acceptance. See the
[Electron runtime guide](../electron/README.md) for development and default launch selection.

## Android / Tauri 2

Use --prepare android-tauri, --build android-tauri, or --build android-tauri --prepare.
The shared menu also dispatches Build and Prepare to Android and returns to that selection.
The same vanilla, React, Phaser or React/Phaser frontend and Rust backend produce arm64 APK/AAB.

Select a full compatible JDK (17–21) through JAVA_HOME and Rust/Cargo 1.90+ for your user.
The arm64 build requires only the aarch64-linux-android Rust standard library target;
armv7, i686 and x86_64 Android Rust targets are not required. A compatible standalone
Rust/Cargo installation with that target is ready without rustup. If the target is missing,
permitted preparation uses an existing selected rustup toolchain with
rustup target add aarch64-linux-android --toolchain <selected-toolchain>.
Without a supported installer, install the required toolchain/target yourself and retry.
Windows also needs approved, non-elevated file symlink permission for JNI staging. These
external actions are reported individually; the Tool does not elevate or change system settings.
An MSVC Rust host reuses compatible C++ Build Tools and Windows SDK for Cargo host build scripts;
GNU hosts need working MinGW host linking. A private host-link probe checks the selected compiler.
ANDROID_HOME or ANDROID_SDK_ROOT selects an existing SDK; otherwise the conventional user SDK
is used. Compatible installations are reused across projects. Protected SDKs are reused read-only.

When allowDependencyInstall permits preparation, the Tool installs checksum-verified official
Command-line Tools, supported SDK Platform/Build-Tools/Platform-Tools/NDK packages, the required
Rust arm64 target, the declared Tauri mobile CLI and checksum-verified bundletool. The selected baseline
is defined in src/android/toolchain.json. SDK licenses require your own sdkmanager --licenses
review and acceptance in that selected SDK. Preparation stops with the exact command, then
resumes after your action and reinspects the actual installations before reporting readiness.

Official Tauri init/build run in private staging, including Gradle resources and Cargo output.
With installation disabled, Rust and Gradle use existing offline caches; populate missing native
dependency caches through an Android build with installation permitted before retrying offline.
Original native configuration, generated project customizations and locks remain source-owned.
Unsupported custom callbacks, external inputs or signing definitions require explicit integration.
New managed identifiers use valid Java package segments. Existing applied identifiers stay stable;
an incompatible older/custom identity needs an explicit user-owned tauri.android.conf.json
identifier override or source update before Android initialization.

Verified results include one unsigned release APK, one AAB and products.json with identity,
archive integrity, arm64 library, toolchain and input evidence. These are local/test products
requiring separate authorized signing before installation or store upload. No signing credentials
are generated or consumed. Device/emulator loading and store acceptance remain separate checks.

## Local settings and results

config.json contains deployment defaults. Put local overrides in .local/settings.json:
{"schema":1,"allowDependencyInstall":false} disables automatic dependency installation.
Choosing a preparation/build action permits supported local npm installation when enabled.

For Vite, the canonical npm run build script must invoke a finite browser build accepting
--outDir and --emptyOutDir. The tool passes an invocation-owned output directory to that
same command; it preserves existing dist and does not rewrite application/package configuration.
Custom build-script side effects remain project-owned. HTML, referenced local assets,
JavaScript, output integrity and stable current-checkout inputs must verify before success.

Applied AstroTS uses the Foundation's Astro 6 static configuration and canonical
npm run build (astro check && astro build), without Vite CLI flags. It requires even
Node >=22.12.0 and npm >=9.6.5. All HTML documents and local asset references must verify;
HTML-only and localized multi-page sites need no generated JavaScript. The existing checkout
lease protects the configured output: prior bytes move into attempt staging, a fresh canonical
build is verified and moved to the attempt's app directory, and prior output is restored even
on failure/cancellation. The immutable result is published only after verification.
If restoring prior output fails, the attempt stays unpublished and preserves previous-output
under its exact staging directory. Follow the diagnostic path to restore those bytes before
retrying; do not delete that staging directory while it contains your prior output.

Verified products are retained under .local/results/<id>/app with result.json.
Future verified builds also publish release-evidence.json with build-owned project binding,
source/version/runtime evidence and complete inventory. Apply the normal resource Update
before rebuilding for release eligibility; older products remain independently usable.
The separately registered Web App Release Adapter consumes one explicitly selected retained
result without rebuilding or changing this Tool's ownership. Its Workspace integration guide is
agent_runner/src/runner/project_management/components/web_app/RELEASE_ADAPTER.md.
Failed/cancelled attempts delete only their own staging directory. Earlier products and
local settings survive updates/removal. To delete old products, choose the exact result
directory yourself. Removal deletes only unchanged receipt-owned installed files; modified
and unrelated files remain. Reinstallation requires resolving any surviving file conflict.

WG1 run entries remain available. Both flows serialize dependency/output writers through
the existing checkout-local .runner/web-app-launch/cache/build.lock. Never delete an active
lock. Managed Tool Add/Update/Remove also acquires this lease through Applied publication
and rollback. If busy, installed Tool files remain unchanged: let the active build/preparation
finish and retry the normal Review/Apply flow. Desired intent remains pending after failed Apply.
After an abnormal process/host termination, first establish that the exact recorded
owner has stopped before manually removing only that stale lock. Other checkouts are untouched.
Tool files, local results/settings and root build entries are excluded from production freshness.

## Adapter extension boundary

targets.json declares identity, runtime dependency, implementation status, output format
and actionable requirements. src/targets.mjs binds only registered implemented adapters.
Each adapter provides inspect, prepare and build; inspection supplies readiness, preparation
eligibility and hints. Execution rechecks readiness under checkout ownership, optionally
prepares, then builds and returns verified integrity/input evidence. Adapters own format-specific
verification. The common execution/result owner alone publishes successful products.

macOS/Tauri, Android/Tauri and Windows/Electron are registered adapters using this same
menu, deployment and result owner. An implemented adapter blocked by host preparation belongs
in Environment Preparation Required; native verification unavailable must remain an explicit
non-success verification state. A missing backend stays Not Implemented regardless of installed
tooling. The Windows/Tauri adapter reuses TypeScript/Vite, checks Rust/Cargo MSVC, Microsoft
C++ tools, Windows SDK and WebView2, and prepares permitted rustup targets/toolchain updates,
local CLI dependencies and SHA-256-verified portable NSIS tools. Missing external installers,
consent, privilege and restart requirements remain actionable blockers. No silent elevation occurs.

Native development uses npm run dev:tauri or npm run dev:electron independently of this Tool; runtime selection and
managed backend maintenance use the existing New/Link/Project Settings Review/Apply flow.
Tauri packaging compiles staged native inputs with --locked and produces either a Windows
AMD64 executable/current-user NSIS installer or native macOS app/dmg. Product identity, architecture, nonempty bytes, hashes and
stable checkout inputs gate immutable publication. Original Cargo/package locks, dist and earlier
products remain intact. Native GUI, signing and installer execution are separate verification claims.
Rust/Cargo generated outputs are ignored. Unsupported custom native staging fails preserving source.

Focused tests in test_web_app_build_targets.py exercise test-owned registered adapters;
test_web_app_build_maintenance.py covers busy deployment, compensation and retry, including
an opt-in real Windows Web build. These fixtures do not supply native production adapters.
Windows entry/build/menu validation is covered by focused native tests. Linux/macOS scripts
are supplied but native execution on those hosts remains unverified when unavailable.
