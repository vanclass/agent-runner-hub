# Session Report

## 1. Task Info
- Task Number: 278
- Task Title: Shared File Preview and Read-Only Text Viewer
- Task Title (KR): 공통 파일 미리보기와 읽기 전용 텍스트 뷰어
- Summary: Refactor attachment previews around a shared format catalog and add source and configuration previews with read-only text controls.
- Summary (KR): 공통 형식 목록을 중심으로 첨부 파일 미리보기를 정리하고 읽기 전용 텍스트 도구와 소스 및 설정 파일 지원을 추가합니다.

## 2. Work Plan
- Extend the existing catalog and use its filename and extension rules in native acquisition, frontend dispatch, and the guide.
- Keep selection, request ordering, cancellation, and disposal with the current local owner. Extract type-specific decoding, image resources, and viewer behavior.
- Render original text with line numbers and optional syntax styling. Add search, wrap, copy, and close controls with English and Korean labels.
- Update the affected implementation specification and run focused native, attachment, generated-image, locale, and build checks.

## 3. Work Summary
- Extended the existing shared catalog with all 35 text extensions and the three recognized filenames. Native classification, frontend dispatch and the File Preview Guide use the same catalog. The native reader dispatches to bounded PNG and UTF-8 handlers.
- Kept request ordering, path verification, stale-result fencing and release coordination in the existing selection owner. Moved PNG Blob URL allocation and its retained byte budget into a selection-local component. Both local and verified generated images use the same focused viewport.
- Added a dedicated read-only text viewer with line numbers, syntax styling, literal search, match navigation, wrap, copy and close. The original string is the source for display slices, search offsets and clipboard copying. Plain rendering remains available for formats without highlighting and files outside the styling budget.
- Updated English and Korean controls and the existing implementation specification in `docs/implementation_specs/runner_terminals.md` and its index. Extended the existing native and Playwright preview tests. The optional Project policy index was absent.

## 4. Validation Evidence
- Rust local preview checks passed (2 tests). They covered every catalog selector, exact original UTF-8 from real files in each requested format group, recognized filenames, PNG bytes, and unsupported, oversized, invalid, missing and directory inputs.
- Focused Chromium checks covered 42 distinct passing cases across runs, including both attachment composers, cancellation and URL release, original-path delivery, localized menus, and synthetic generated PNG/GIF presentation. The first batch reached its 120-second cap and exposed a stale staged-badge assertion. The two remaining checks passed in a focused run after updating the locale assertion to check the visible attachment opener.
- The final 14-case local preview and guide batch passed. The exact text-controls test also passed with a wheel-scroll assertion. It verified literal search and match navigation, line numbers, wrap, unchanged rendered text, exact clipboard text including CRLF, and close with opener focus restoration. Reviewed the English Light and Korean Black viewer and guide captures in `test-results/web-app/1cb743da-ca81-47c5-9e14-9580fa0474d0/report/`.
- Both background Windows WebView2 cases passed and released their owned resources. They covered actual local filesystem IPC through the attachment UI, guide containment and catalog tags, and the synthetic generated-image consumer. Evidence is under `temp/native-probe/deb3d5f5-bad1-4ec6-bfa9-c5fbc3e0f019/`. The probe built before the text row helper consolidation. The final renderer passed the build and focused Chromium checks.
- TypeScript/Vite build, English/Korean localization validation and source diff checks passed. Changed source and specification files retained their UTF-8 and line-ending profiles, and the moved Korean tuning comment matched the original.

## 5. User Verification Message
- Open a supported source attachment and use Find in file, Word wrap, and Copy text. The guide in Help lists every supported format. Automated evidence covers this flow in Chromium and actual file acquisition in background Windows WebView2. Native OS clipboard interaction, physical desktop gestures, and macOS presentation remain unverified.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"278","task_workload_id":"cdbef961a7bd45eabcbaad43aa4fb502"}
<!-- TASK_END_RUNTIME_METADATA_END -->
