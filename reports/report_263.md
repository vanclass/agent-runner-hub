# Session Report

## 1. Task Info
- Task Number: 263
- Task Title: Reusable background Hub automation
- Task Title (KR): 재사용 가능한 Hub 백그라운드 자동화
- Summary: Consolidate native UI interactions and migrate core Hub scenarios to use the existing hidden WebDriver lifecycle.
- Summary (KR): 네이티브 UI 조작을 통합하고 기존 WebDriver 수명 주기를 활용해 숨겨진 Hub에서 핵심 시나리오를 실행한다.

## 2. Work Plan
- Trace the existing React controls, native case lifecycle, and authoritative Runner observations.
- Split generic DOM interactions from Hub actions and migrate installation, configuration, and composer consumers.
- Separate background work delivery from displayed presentation checks and document how to compose a custom native case.
- Run focused tests and Windows background cases using the installed Runner and isolated Hub profiles. Record actual delivery, configuration, and settlement evidence.

## 3. Work Summary
- Added importable DOM interaction primitives and Hub actions for installation verification, navigation, configuration drafts, and both composer surfaces.
- Migrated native installation, configuration, read-only, and submission consumers and the dependent WG3 browser fixture. The existing driver, environment, platform adapters, and process owners run the cases.
- Split hidden configuration and work checks from explicitly selected displayed composer and terminal assertions. Background lifecycle checks now reject visible Hub windows after case actions.
- Provider-qualified account and model choices follow the effective Provider catalog. The existing right panel displays the current and configured startup Provider and offers no cross-Provider switch.
- Updated the existing native automation specification and usage guide with the helper boundaries, case entry points, and a custom case example. The Workspace index for AgentRunnerHub-specific policies was absent.

## 4. Validation Evidence
- Windows invocation `7c216cdd-cf92-4182-924e-2ed8f9341982` passed installation-entry, configuration-selection, semantic-work, and single-entry-work. The installed path was verified by the native resolver. Configuration exercised Provider-qualified account and model, effort, Fast, mode, Target, and Direct Root through the right panel and kept the inspected Runner revision unchanged.
- Both work cases used the normally installed and authenticated Runner. Each matched the submitted request to canonical start and successful completion, cleared the originating draft, and verified execution release. All four passing cases stayed hidden at the lifecycle samples and recorded no activation, normal Hub exit, and listener release.
- Windows invocation `0122b4f1-67ca-48ff-becf-f734db1742ae` passed dom-interactions and runner-read-only with the same hidden-window and settlement evidence. The DOM case checked untrusted events and geometry. Read-only inspection matched the owned session and confirmed a stable revision and removal of the closed PTY.
- The focused native reruns verified three corrections. Renaming the installation rejection field avoided a WebDriver response collision. Scroll now allows fractional CSS pixels. Read-only inspection waits for the Hub's startup catalog before requesting its receipt, avoiding competition with initialization reads.
- Passed 33 focused Node tests for Runner observation correlation, lifecycle, and platform boundaries.
- Passed focused Chromium checks for the shared DOM and configuration consumers, Provider observations, no-op submission, plan/apply receipts, and typed Run and Brief. The first Chromium selection also passed 14 prepared-instruction cases and the installation correction case.
- One additional Chromium Apply scenario timed out selecting an `other` Provider account under the effective Codex catalog. The scenario uses the existing product controls directly. Both the Provider-scoped catalog and the separate plan/apply receipt scenario passed.
- Actual Brief and typed Run admission, displayed assertions, macOS, and trusted physical input were outside the native checks executed here. Chromium exercised the Brief and typed Run product paths with synthetic Runner transport.

## 5. User Verification Message
- Use the native probe README for the executable case selections, reusable API, and custom case example. Select `semantic-work` and `single-entry-work` with the existing Runner installation to check actual background work. The optional presentation cases have separate IDs.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"263","task_workload_id":"676caa0e8e644ad0a70e282397f0c6fa"}
<!-- TASK_END_RUNTIME_METADATA_END -->
