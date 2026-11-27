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
| Actual installation UI/resolver, native configuration and submission | Background native cases | Real Tauri assets/IPC with the installed Runner and its ordinary authentication |
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

`semantic-presentation` (retained case ID) compares original xterm scrollback and visible rows with diagnostic canonical records for `/help`, then checks retention after a read-only invalid `/files` argument rejection. The fresh owned Hub uses the existing verified installation and displays its original terminal. This case does not submit Provider work; browser fixtures do not establish installed-Runner delivery.

The explicitly selected background cases `semantic-work` and `single-entry-work` submit
one harmless Pure Direct instruction each through the Runner and Single Entry
composers. They require canonical work start, successful completion, execution
release and clearing of the originating draft. Both use the installed Runner's
startup account and model. The separately selected `semantic-work-presentation`
and `single-entry-work-presentation` repeat the corresponding work to check xterm
output, instruction retention and composer layout.

Presentation cases click the ordinary Add Runner action before waiting for a connection. A hidden Spare is optional. Read-only renderer inspection binds the active sidebar tab and mounted xterm to their existing RunnerSession control identity; native observations and command receipts must match that exact PTY and generation. Unavailable renderer identity is unverified, never permission to assume the first observed session is the destination.

Work cases submit their declared instruction directly after native/configuration readiness; they do not require an unrelated `/help` command to produce PTY text. The separate command case retains that observation and its own failure boundary.

```text
node tools/native-probe/hub.mjs --help
node tools/native-probe/hub.mjs --case installation-entry
node tools/native-probe/hub.mjs --case dom-interactions
node tools/native-probe/hub.mjs --case renderer-probe --case language-preference
node tools/native-probe/hub.mjs --case configuration-selection --case runner-read-only --runner-root "<absolute Runner Workspace root>"
node tools/native-probe/hub.mjs --case semantic-work --case single-entry-work --runner-root "<absolute Runner Workspace root>"
```

Repeat `--case` to compose only the required cases in one build; each still gets a
fresh owned process/profile. With no case selector, the three WG3 cases run.
`--target-dir <absolute Cargo cache>` works with either native entry.
Installation-entry checks mandatory setup, native rejection of a relative path,
unchanged saved installation and retry availability. Configuration-selection uses
the ordinary authenticated account's catalog to edit and persist a Hub draft and
verifies that the native configuration revision stays unchanged.
`configuration-presentation` checks the displayed composer and activity layout.
Runner-read-only compares Hub selections and native inspection in the same
observed session/generation and verifies unchanged native revision. It then closes the exact observed
PTY and verifies removal from the native session registry.

## Isolated IssueRun sidebar case

The Windows `issue-sidebar-lifecycle` case stages a disposable producer from the
accepted Workspace Git object. Supply an absolute local repository containing
that object. The setup uses Git, Windows tar and Python with the installed Runner
Python dependencies available for local copying. It creates an independent
interpreter environment, fixture account, Workspace and local publication remote.

```text
node tools/native-probe/hub.mjs --case issue-sidebar-lifecycle --producer-source "<absolute local producer Git repository>"
```

The case checks initial authenticated idle, Work admission, early live
Interpretation, committed Discussion, and one canonical fixture reply. Its
evidence includes the exact native build, marker shape, color and computed
accessible name, IssueRun/Thread/Turn correlation, and owned settlement. Results
apply to the scripted App Server peer and background WebView2 composition.

## Existing Runner installation prerequisites

Supply `--runner-root` with the existing normally configured Runner Workspace root containing
`src/runner/__main__.py` and `local/runtime/python-env/`.
The standalone `tests/native/preview-views.mjs` cases read this root from
`HUB_RUNNER_ACCEPTANCE_ROOT`.
The fresh application profile needs its own installation
selection; no user Hub profile is copied. The actual installation form/native
resolver verifies the managed runtime before the Hub session owner launches a new
Runner. Ordinary startup account authentication and `session_config.inspect` are
required; no saved Test account or second installation is needed. Missing authentication/capability
remains blocked. Each selected work case submits through the application's normal
authentication and delivery flow from its own Hub profile and process.
Use the normally installed runtime, never an already-running Hub or Runner session.
If startup authentication or inspection is unavailable, retain the exact blocked
reason and complete independent installation/UI, fixture and headless checks.

Read-only instrumentation forwards callbacks unchanged. Native Tauri has immutable
`invoke`; its existing callback map exposes the Hub-created PTY event ID without
retaining terminal bytes. The case observes that exact session with `runner_observe`.
Synthetic fixtures use their writable invoke wrapper. Neither replaces responses.
Only `session_config.inspect` feature requests are issued by the case. Evidence retains
transport admission separately from the matching completed authoritative receipt.
Account identity and credential paths are not copied into case observations.
Configuration-selection edits the isolated Hub draft with the verified catalog.
Read-only comparison respects unbound UI selections
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

For focus-required checks, select a Windows case with `presentation: 'focus-required'`
and `settle(browser)`, then pass it alone (or with other focus-required cases) to
`nativeSuite`. The suite selects the existing staged build with a focusable main
window. Direct `createEnvironment` callers must explicitly pass `{ focusRequired: true }`
and use matching cases. Ordinary invocations retain unfocusable windows.
`ready(browser)` must finish application readiness before nonactivating display;
Work acceptance must also verify the intended bound Target and advertised reference/
Work capabilities before native Enter. A fresh profile's installation selection and
account readiness alone do not establish a bound Target.
`run(browser, {pid, hwnd})` receives the exact owned input target. Use the existing
Runner Computer Use tools after their
authorization and exact owned process/window readiness checks. There is no native
CLI flag that grants foreground input. Record observed effects and settle input
through that owner; do not use WebDriver focus/click fallbacks or manual DevTools.
The case must verify input release and settled Discussion authority (if submitted)
in `settle` before returning to normal driver/Runner/process/profile teardown.
Unsettled authority preserves those resources and fails the case.
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

Import `Dom` from `tools/native-probe/dom.mjs` for CSS-selector-based `click`,
`doubleClick`, `rightClick`, `hover`, `changeValue`, `key`, `dispatch`,
`scroll`, `drag`, `paste` and `state`. Read state for value, checked, disabled, focus,
geometry, scroll offsets and select options. `changeValue` uses the native DOM
setter and dispatches input or change for controlled React fields. `click`
invokes DOM activation, including checkbox toggling and submit buttons.
`doubleClick`, `rightClick` and `hover` deliver handler events. `key` focuses
the DOM element and dispatches keydown and keyup with supplied modifiers.
`drag` sends HTML drag events with one in-memory DataTransfer and drops only
when the destination accepts dragover. These interactions provide synthetic
handler evidence. Trusted input, CSS hover, keyboard default editing, native
menus, file transfer and dialogs need their own supported validation path.

`Dom.paste(selector, text)` dispatches an in-memory paste event. For an editable
textarea, an uncancelled event simulates replacing the current selection or
inserting at the caret. It normalizes line endings, respects the textarea length
limit, and notifies the regular input handler. Image content takes
`{ bytes, name, type }` and goes through the application's paste handler.
The return value reports `{ cancelled, inserted }` for the event and text edit.
Wait for the attachment inventory to confirm image capture. Neither form accesses
the OS clipboard or establishes trusted clipboard delivery.

Import `HubActions` from `tests/native/webdriver/hub-actions.mjs` for the Hub
installation form, Single Entry selection, Runner creation and tab selection.
`addRunner()` returns the new active tab ID. Use `field(name)` to read the
rendered choices and requested value, and `edit(name, value)` to use the
ordinary controls. Fields are `account`, `mode`, `target`, `model`,
`reasoning`, `fast`, and `directRoot`. Use catalog values as returned, including
the Provider in account and model identities. `selectProviderAccount(provider,
account)` selects a qualified account in the current effective Provider catalog.
The panel shows effective and configured startup Provider labels. `fast` takes
a boolean when the model offers both Fast and default service tiers. Mode governs
whether Target or Direct Root is rendered. Check applied settings with the
existing Runner observations after the relevant product operation.

Use `draft(surface, text)` and `submit(surface)` with `single-entry` or
`runner`. Enter follows the ordinary instruction and supported slash-command
paths, including typed `/run` where available. Pass `{ brief: true }` for the
IssueRun Control+Enter Brief action. Observe the authoritative result before
making assertions about submission, and leave uncertain effects unreplayed.

### Compose an attachment scenario

`hub.attachments` uses the mounted Single Entry or selected Runner composer.
Select the owning surface first. `dropPaths(surface, paths)` accepts explicit
absolute file and folder paths through the existing scripted native drop event.
It opens no picker and needs no physical drag. The app validates and classifies
paths during its ordinary attachment flow. `pasteText` and `pasteImage` dispatch
in-memory clipboard content to the chosen composer.

```js
await hub.selectSingleEntry();
const surface = 'single-entry';
const { attachments } = hub;
await attachments.dropPaths(surface, [absoluteTextFile, absoluteFolder]);
await attachments.pasteImage(surface, { bytes: pngBytes, name: 'sample.png', type: 'image/png' });
await hub.wait(async () => (await attachments.inventory(surface))?.items.length === 3, 'Cards missing');
await attachments.openPreview(surface, 0);
await hub.wait(async () => (await attachments.viewer.state())?.text != null, 'Text preview missing');
await attachments.viewer.close();
await hub.wait(async () => !await attachments.viewer.state(), 'Preview still open');
await attachments.remove(surface, 1);
await hub.wait(async () => (await attachments.inventory(surface))?.items.length === 2, 'Folder card still present');
await hub.draft(surface, '');
await attachments.pasteText(surface, 'Summarize the attached sample.');
await hub.submit(surface);
```

For a Runner tab, call `selectRunner(tabId)` or `addRunner()` and use
`surface = 'runner'`. Inventory reports visible card order, paths, state messages,
removability, thumbnail dimensions, and composer alerts. Read it again after edits
before using a card index. Registration happens during ordinary submission.
Correlate the resulting `references.register`, verified inventory, and original
`work.submit` observations with the owning PTY and generation.

### Inspect and open a generated image

```js
const { images } = hub;
await hub.wait(async () => (await images.state())?.refreshDisabled === false, 'Refresh unavailable');
await images.refresh();
await hub.wait(async () => (await images.state())?.items.length > 0, 'Image inventory empty');
const { items } = await images.state();
await images.select(items.at(-1).id);
await hub.wait(async () => (await images.state())?.preview?.width > 0, 'Preview missing');
await images.openPreview();
await hub.wait(async () => (await images.viewer.state())?.image?.naturalWidth > 0, 'Viewer image missing');
await images.viewer.zoom(-300);
await hub.wait(async () => (await images.viewer.state())?.image?.scale > 1, 'Zoom missing');
await images.viewer.close();
```

The same viewer operations apply to local image attachments. Synthetic wheel
and dialog close establish handler behavior. Native Escape, pointer capture
and pan, physical clipboard and drag delivery, and displayed animation retain
their existing input or presentation checks.
For provenance evidence, `images.list(sessionId)` and
`images.read(sessionId, imageId)` read the existing native inventory and bytes for
an exact, caller-verified connection. Classify results from an injected image
fixture as consumer evidence. Actual generation provenance requires a genuine
item from an authenticated Runner session.

```powershell
node tools/native-probe/hub.mjs --case attachment-work --runner-root "<absolute existing Runner root>"
$env:HUB_RUNNER_ACCEPTANCE_ROOT = "<absolute existing Runner root>"
$env:HUB_PREVIEW_BACKGROUND_ONLY = '1'
node --test tests/native/preview-views.mjs
```

`attachment-work` uses the installed Runner's startup account and submits one
harmless Pure Direct instruction with a clipboard image. The background-only
preview selection checks native local file/folder paths and a synthetic
generated image with the window hidden. The existing displayed preview and GIF
frame checks require an explicit presentation invocation.

For installed Runner scenarios, use `readyInstalledHub(browser, runnerRoot)`
from `tests/native/webdriver/runner-flow.mjs` as your readiness callback.
It verifies the installation and starts observing Hub-owned connections.
Use that module's `visibleConnection` for the active Runner tab and `inspection`
for its authenticated native configuration.

Export a `defineNativeCase` value from an application-owned module, then pass it
to `nativeSuite([myCase], { root, target })` from a node:test entry. The existing
`run.mjs` is the composition example. Use `node --test <your-entry.mjs>` for an
independent selection; there is no persistent test registry or automatic method fallback.
Use unique path-safe case IDs. `ready(browser)` owns bounded application readiness;
`run(browser)` owns assertions through existing runtime/DOM entry points.
For `presentation: 'nonactivating'`, provide `observe(browser)` for displayed checks.
For `presentation: 'background'`, the window stays hidden and no capture/display is requested.
The environment resets profiles between cases; do not depend on another case's state.

For example, save this as `tests/native/custom-installation.mjs` and run
`node --test tests/native/custom-installation.mjs` from the checkout root.

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import { defineNativeCase } from '../../tools/native-probe/case.mjs';
import { nativeSuite } from '../../tools/native-probe/suite.mjs';
import { HubActions } from './webdriver/hub-actions.mjs';
import { readyHub } from './webdriver/probe.mjs';

const root = process.cwd();
const myCase = defineNativeCase({
  id: 'custom-installation',
  presentation: 'background',
  ready: readyHub,
  async run(browser) {
    const hub = new HubActions(browser);
    await hub.installationPath('invalid-relative-installation');
    const result = await hub.verifyInstallation();
    assert.match(result.rejection, /absolute path/i);
    return { rejected: true };
  }
});
nativeSuite([myCase], { root, target: path.join(root, 'local/native-probe/target') });
```

Window operations belong to the platform adapter. macOS displayed cases start
nonactivating at native Ready; Windows performs actions hidden before rear placement.
The evidence records that distinction. Missing capabilities, blocked prerequisites
and unverified observations are non-pass outcomes. Focus-required testing continues
to use the existing authorized Computer Use path; these callbacks authorize no input.
