# IssueRun Candidate Report

## Task Info
- Task Number: 157
- Task Title: Align Hub activity sentences with the composer
- Task Title (KR): 허브 액티비티 문구와 입력창 좌단 정렬 개선
- Summary: Shared responsive composer spacing and a unified localized Hub sentence are implemented. Browser checks passed; native presentation evidence is recorded below separately.
- Summary (KR): 입력창과 상태 문구의 반응형 좌측 여백을 공유하고 Hub 상태를 한 문장으로 표시했습니다. 브라우저 검증을 통과했으며 네이티브 표시 검증은 별도로 기록합니다.

## Work
- HubActivity now renders its existing localized prefix and message in one uniformly styled span. Outcome classification and polite atomic status semantics are unchanged.
- The workspace owns the existing wide/narrow composer inset; both composer variants and the footer consume it. Idle still reserves an empty single line.
- Extended existing Hub activity and session-config UI cases. Updated the existing runner_session_config.md UI section; index destinations remain valid. No additional state, polling or catalog keys were needed.

## Validation
- npm run build: passed. npm run test:i18n: passed (catalog/source parity).
- Focused browser command: hub-selections.spec.mjs and runners.spec.mjs, grep Hub Activity|configuration receipts|session submission applies exact: five passed.
- Component presentation checks cover English/Korean, both composer styles, idle transitions and widths 1280, 1101, 1100, 900, 801, 800 and 640. These use controlled service props and are supplementary to the integrated simulated-transport Runner submission/context check.
- git diff --check passed. Modified files retain LF/no-BOM UTF-8; existing Korean hub.css comments are byte-preserved. No shell rewrite fallback was used.
- Native renderer probe: first run failed an exact floating-point edge comparison before display; the fixture now uses the existing configuration case's subpixel tolerance and records the gap. Rerun passed with gap -0.000038px, a stable empty footer, actual nonactivating display and clean owned teardown. Both native builds used Candidate assets index-BbOvPiGU.css and index-DK-KLbbN.js. The raw shell pipeline returned 1 with stderr formatting, while the finalized case evidence reports passed and both node tests passed; these outcomes are retained separately.
- Native active-sentence readability/alignment remains unverified: the supported renderer probe captures the fresh installation dialog and empty footer, not an active Runner/Single Entry status. Browser fixtures cannot establish that stronger displayed property. No full REQ-HUB-ACTIVITY completion is claimed.
- Read-only Project catalog confirmed this Candidate and installed Vite/React/Tauri capabilities. No configuration changes were needed. The frozen exact-Target Project policy index is absent.

## Review
- Runner retains independent Review, Candidate commit and publication. Changes are uncommitted.
- Handoff is blocked only on the remaining native active-text observation. Preserve the implemented changes, passing narrower checks and original failed native evidence for independent Review; further native coverage must exercise actual active text through an owned supported UI flow.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-91","work_group_id":"WG-HUB-ACTIVITY","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
