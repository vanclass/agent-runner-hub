# IssueRun Candidate Report

## Task Info
- Task Number: 166
- Task Title: Shared focused previews and extension Help
- Task Title (KR): 공용 집중 뷰어와 확장자 Help 복구
- Summary: Delivered shared image focus/gestures, original text viewing and catalog-backed Help. R07/R08 are supported; genuine R04/R05/R06 completion remains WG04-owned.
- Summary (KR): 공용 이미지 집중 보기와 확대·이동, 텍스트 원문 보기 및 확장자 Help를 구현·검증했다. R07/R08을 충족하며 실제 생성 이미지의 R04/R05/R06 완료 판정은 WG04에 남는다.

## Work
- Plan: Reuse WG01 acquisition/catalog/lifetimes; restore FocusedViewer and PreviewHelp, migrate consumers, then validate local image gestures, text, Help and affected lifetimes. Preserve generated provenance and submission contracts. WG04 retains genuine-output acceptance.
- Implemented: Restored FocusedViewer/ImageViewport and PreviewHelp from retained source, adapted consumers to WG01's public preview/catalog interfaces, and composed Help after App Settings. Local focus headers use basenames; no generated name is fabricated. Removed the obsolete generated dialog, its exclusive styles and unused locale keys.
- Ownership: ImageViewport alone owns transforms; FocusedViewer owns modal/focus return. Existing local/generated acquisition, URL cleanup, attribution withholding and exactly-once submission owners remain unchanged. Existing path/phase/order controls remain outside this group's presentation delta.
- Specification decision (R04–R08): Updated the existing canonical runner_terminals.md presentation heading and IMPLEMENTATION_SPEC_INDEX.md source/test route; no duplicate feature document. Native and synthetic evidence boundaries remain explicit.

## Validation
- PASS: TypeScript/Vite build; final native staged frontend build and ordinary Cargo library check (ordinary graph excludes WebDriver); English/Korean catalog validation.
- PASS: Both composers' local image basename/containment, two-way rendered wheel zoom, pan, source/proportion preservation, Escape/focus return and reopen/switch reset. Both composers display exact multiline Korean txt/md/json and retain unavailable/unsupported/folder selections. Help position, domains and shared catalog contents pass; native IPC independently confirms original txt/md/json display.
- PASS: WG01 exact cancellation/success URL retirement, uncertainty retention, disposal and delayed-publication fences on both selection owners; attachment staging/ordered submission/Single Entry isolation regressions. Generated-consumer fixture additionally passes shared rendered gestures and existing refresh/tab isolation; it is synthetic.
- PASS: Nonactivating Windows Tauri display shows the contained image and dark backdrop, correct basename and no close-preview button. Native fixture exited normally, released its loopback listener and cleaned its isolated profile. Physical OS gestures and macOS runtime are unverified.
- Retained failures: Initial browser batches hit selector/case/position expectations (including closed Help), with one aggregate timeout; native's first run also counted the closed Help button. Corrected those test assumptions, preserved existing chip path behavior, reran affected checks and retained raw failure logs. Locale checks exposed obsolete keys; removed them and reran successfully. No product acceptance is inferred from failed aggregates.
- Evidence: Invocation-owned build/i18n/browser/native logs and immutable browser/native evidence archives accompany role_result.json. Final source remains uncommitted at ff2a9b383627ca1afe413e519d36c35c2d8eb392; all changed text remains LF, UTF-8 without BOM, and preserved Korean comments were verified.

## Review
- Ready for independent Revision Review of WG03's complete assigned capability and R07/R08 observations. No planning reconsideration is requested. Genuine owning-connection generated-output acceptance and F02 remain WG04-owned; no generation, foreign-session adoption or publication was attempted. Runner owns staging, commit, integration and publication.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-93","work_group_id":"WG03","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
