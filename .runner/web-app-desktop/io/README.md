# Tauri Native I/O

## 문서 목적

공식 Tauri 플러그인으로 클립보드 이미지, 파일 선택 및 드롭을 연결하는 방법을 설명합니다.

## Selection and usage

Select Web App → Runtimes → Tauri 2 and Tools → Tauri Native I/O, then Review/Apply. It defaults to Off. Import the helpers from `.runner/web-app-desktop/io/nativeIO.ts` into application code; no application entry point is replaced.

```ts
import { clipboardImagePng, selectFiles, selectFolder, watchFileDrop }
  from '../.runner/web-app-desktop/io/nativeIO';

const files = await selectFiles(true); // string, string[] or null (cancelled)
const folder = await selectFolder();
const png = await clipboardImagePng(); // handle no-image/platform errors in the application
const stop = await watchFileDrop(paths => console.log(paths));
// When this consumer is disposed:
stop();
```

The clipboard helper copies raw RGBA pixels into ImageData, encodes a PNG Blob and closes the Tauri Image resource in finally. Raw RGBA is not a PNG. If a consumer creates an object URL for a preview, revoke it when the preview is removed.

In React, retain the listener's asynchronous unlisten handle and dispose even when registration resolves after unmount:

```ts
let disposed = false;
let stop: (() => void) | undefined;
void watchFileDrop(onPaths).then(unlisten => {
  if (disposed) unlisten(); else stop = unlisten;
}).catch(onError);
// effect cleanup:
disposed = true;
stop?.();
```

## Permissions and ownership

The existing Tauri builder registers the official clipboard-manager and dialog plugins only with the selected desktop `native-io` feature. Staging installs the managed capability for the main window on Windows/macOS. Permissions cover image reading/size/RGBA/resource-close, dialog open and event listen/unlisten; no clipboard text/write, generic filesystem access or save-dialog permission is added. Existing application capabilities retain their independently granted permissions.

Native file-drop payloads carry paths and physical cursor coordinates. Keep Tauri native drag-drop enabled. Paths are inputs for application-owned processing; selecting/dropping a file does not grant generic frontend file-content access. File ownership, attachments, persistence and instruction submission belong to the application.

New/Settings install missing declared frontend dependencies through the existing npm effect. Link requires compatible existing declarations and preserves package, lock and source bytes. Customized managed examples or incompatible native integration fail explicitly; restore/integrate them and retry Review/Apply. Android/browser usage is unavailable for these desktop image helpers.

## Verification boundary

TypeScript compilation and Rust plugin compilation check API wiring. Actual clipboard image access, native file/folder selection and window drag-drop require safely owned native windows on Windows and macOS. Those observations are independent of compilation and remain unverified where no native UI check was performed.
