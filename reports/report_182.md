# IssueRun Candidate Report

## Task Info
- Task Number: 182
- Task Title: Restore shared attachment presentation
- Task Title (KR): 첨부 표시 복구 및 기존 검증 적용
- Summary: Restore basename labels, retire attachment ordering, and recover responsive tiles while preserving preview and delivery ownership.
- Summary (KR): 첨부 파일명 표시와 반응형 타일을 복구하고 순서 변경 기능을 제거하며 기존 미리보기와 전송 동작을 유지한다.

## Work
- Plan: adapt the retained WG01 renderer/layout in the current Candidate, remove the selection move API and its direct consumers, update the existing specification, then run the ordinary build and affected browser checks. Runner owns Review and publication.
- Restored basename/folder labels, omitted normal staged decoration, removed arrows and the public move method, and retired its two locale keys. Cancellation, native paths, IDs, session binding and actionable reconciliation retain their original owners.
- Adapted the retained 144px tiles/120px contained images in the existing shared CSS. No new presentation or state owner: selection remains canonical; basename is a render-only projection. Editable input, clipboard acquisition, history, persistence and submission representations remain unchanged. A second display-state model was rejected as unnecessary synchronization.
- Updated direct test selectors and the existing registered runner_terminals specification paragraph for labels, ordering retirement and shared wrapping. The index already routes this responsibility; no new document or duplicate description was needed. The frozen Workspace Project-policy index is absent; project specifications remain independently applicable through docs/implementation_specs.
- Retained generated provenance, local/native readers, FocusedViewer, Help and instruction-outline owners. Retained R07 native evidence uses actual filesystem IPC and original.txt/md/json production textContent; unchanged reader/viewer hashes plus current shared-consumer checks support reuse. Accepted Help/outline evidence remains applicable and current focused checks also pass.

## Validation
- npm run build: passed after offline lockfile dependency installation; the first attempt lacked node_modules/tsc. Vite retains its nonblocking bundle-size warning.
- Focused browser batch: 30 passed, 2 layout-test failures. The initial 1000/1280 widths produced the same four columns due to available-area behavior. Corrected only the test widths to 1280/1440/1920; both layout checks then passed with [4,5,8] columns. All 32 selected contracts now have passing evidence; the first aggregate remains failed.
- Checks cover basename/folder/paste identity, no ordering controls, intended-item removal and once-only original-path delivery, exact selected/pasted URL retirement and uncertainty/delayed-read handling, both local image/text viewers, gestures/reset, Help and focus/keyboard behavior. Final layout screenshots show consistent contained tiles on both composers, matching the original Hub/gpt1/gpt2 scale/wrapping direction. Browser bridge observations are simulated native transport, not physical OS input.
- node tools/i18n/check.mjs: failed only for pre-existing hubLog.unsaved. The changed locale diff removes attachment ordering keys only; HubLog ownership and the flagged key are unchanged and independent of attachment rendering. Historical browser/i18n aggregate failures remain failures; unrelated restart/discovery aggregates and native/platform checks were not rerun.
- git diff --check and focused source/reference inspection passed. Localized LF edits preserve unrelated bytes, existing comments and BOM state; recovered Korean CSS tuning comments and the Korean report fields were checked for readable UTF-8 without replacement characters. Exact source/diagnostic references and scoped prerequisite assessments are in invocation artifacts.

## Review
- WG01 implementation and assigned scoped obligations are complete for independent Review. This is not Review approval, integration or publication. Changes remain uncommitted for Runner-owned SCM.
- R01 physical OS transfer remains unverified for WG02. Genuine authenticated generated-image retrieval/presentation/name/native gestures remain unverified for WG03. Retained empty-inventory/scripted-input limitations remain historical; no unchanged failed method was repeated or promoted to external success.
- User verification message: the Candidate presents filename tiles and removes ordering while preserving local preview/delivery behavior. Runner's independent Review and publication are still required; no whole-IssueRun completion is claimed.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-100","work_group_id":"WG01","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
