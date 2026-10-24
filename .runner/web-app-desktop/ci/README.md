# Desktop CI

## 문서 목적

독립 프로젝트에서 Windows 및 macOS 네이티브 검사를 실행하는 선택형 CI 템플릿을 설명합니다.

## Select and run

Select Tauri 2, Web App Build System and Tools → Desktop CI, then Review/Apply. The managed `.github/workflows/desktop.yml` builds only the project's published source/resources and lockfiles. It requires no private Runner checkout, release publishing, signing credentials or notarization credentials. Existing workflows are preserved; a conflicting path requires explicit resolution.

The native matrix pairs Windows x64 with `windows-2022`, Apple Silicon with `macos-15`, and Intel with `macos-15-intel`. Explicit target triples avoid treating `macos-latest` as an Intel selector. Hosted-runner availability and images can change independently of this template.

Jobs run the existing commands:

```text
npm ci --no-audit --no-fund
npm run build
node .runner/web-app-tauri/check.mjs
node tools/web_app_build_system/src/entry.mjs --build windows-tauri --prepare
node tools/web_app_build_system/src/entry.mjs --build macos-tauri --prepare
```

Each job selects its own native build command. The Rust check entry reuses native prerequisite inspection, checkout ownership, backend/feature staging, Cargo lock resolution and owned cancellation. The native build is the existing Build System adapter and immutable publication path. Missing host prerequisites fail explicitly; CI does not invoke privileged installers or accept licenses.

Results are archived under the ignored Build System `.local` directory before artifact upload. Tar preserves `.app` executable permissions; artifacts have separate architecture names and missing output fails the upload. Compilation, Rust PTY tests and byte-verified native packages are separate from installer execution, GUI interaction, Gatekeeper, signing and notarization.

Run the workflow through push, pull request or workflow_dispatch in the consuming GitHub repository. Local checks do not establish that all hosted jobs have executed successfully. Keep native-host and GitHub execution evidence separate.
