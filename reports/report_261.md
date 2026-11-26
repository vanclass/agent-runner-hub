# Session Report

## 1. Task Info
- Task Number: 261
- Task Title: Show the configured startup Provider and verify installed Runner integration
- Task Title (KR): 시작 Provider 표시 및 설치된 Runner 연동 검증
- Summary: Present authenticated startup Provider evidence separately and finish the installed Runner checks from Task 260.
- Summary (KR): 인증된 시작 Provider 정보를 별도로 표시하고 작업 260의 설치된 Runner 연동 검증을 마무리한다.

## 2. Work Plan
- Trace authenticated observations into Single Entry and Runner-tab settings. Add startup Provider presentation without changing how the effective Provider controls selections.
- Update localizations, specifications, and focused tests for observation changes and missing or unsupported evidence.
- Exercise the configured Runner installation and record evidence for catalogs, test accounts, fresh and retained sessions, configuration surfaces, and owned shutdown. Keep installed observations distinct from controlled fixtures.

## 3. Work Summary
- Hub carries `observation.configured_startup_agent_id` through the authenticated native snapshot. Single Entry and Runner-tab settings display it beside the effective Provider. Codex, Claude and None are distinct. Missing, null and unsupported values display Unavailable.
- The startup label follows existing observation refreshes. Account and model selection still use the effective Provider and the exact catalog account. Startup evidence does not participate in preferences, session bindings, workload allocation or recovery.
- Updated English and Korean labels, the Session Configuration specification, and the focused native and UI checks. The exact Project policy index was absent from the task manifest.

## 4. Validation Evidence
- Installed Runner on Windows with the Task 6016 Local Control correction. The production native client authenticated v1 hello, delivered observations, returned 3 Codex accounts and 10 models and 2 Claude accounts and 14 models, and verified each model catalog against its current Provider-qualified account. Both authorized Provider-qualified test-account requests passed under both effective Providers, with canonical homes and unchanged configuration revisions.
- Installed Runner on Windows. The existing Runner settings owner temporarily selected Claude and then None. Fresh sessions adopted the configured Provider. The retained sessions observed the new startup value and kept their original control generation, Provider, account and model. Each owned session exited and the original Codex startup preference was restored.
- Native Hub window against the same installation. The existing configuration-selection probe passed for Codex. It checked both settings surfaces against authenticated evidence, exercised account, model and Run Mode drafts, verified the unchanged Runner configuration revision, and completed owned teardown.
- Native Hub transition against the same installation. The final probe displayed matching Codex, Claude and None values in fresh tabs. It displayed Codex with configured Claude, then Claude with configured None, in Single Entry and the corresponding retained tabs. It preserved both retained tab identities and completed owned teardown. The first probe expected the first new tab to launch a fresh process and instead observed the existing spare being promoted. The rerun accounted for that existing reuse behavior.
- Controlled fixtures. Six focused browser cases passed. They covered startup observation updates, matched and differing labels, None, missing, null and unsupported startup values, retained Codex and fresh Claude choices, and both Provider-qualified test-account requests. The native observation regression, authenticated hello identity test and 13 Session Configuration tests passed. TypeScript, Vite and native compilation passed.
- The localization aggregate reported the same two unused Hub Log keys recorded in Task 260, `hubLog.older` and `hubLog.unsaved`. The Provider keys and interpolation passed. Missing, null and unsupported evidence was verified with fixtures. The installed Runner supplied valid configured values. Retained identity was verified with owned idle sessions, without starting a workload.

## 5. User Verification Message
- In Single Entry or a Runner tab, compare Effective Provider and Configured Startup Provider in Account settings. When the Runner preference changes, an open tab keeps its effective Provider, and a newly opened Runner takes the new preference. Both authorized test accounts and the installed catalogs were verified.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"261","task_workload_id":"f975eb7bb6f842698a3d689898ac7879"}
<!-- TASK_END_RUNTIME_METADATA_END -->
