# Session Report

## 1. Task Info
- Task Number: 265
- Task Title: Consolidate background Hub automation
- Task Title (KR): Hub 백그라운드 자동화 통합
- Summary: Extend the native probe with reusable Runner management, observation, terminal, logs, preferences, and restoration helpers. Migrate functional cases to hidden execution and retain separate presentation and input coverage.
- Summary (KR): 네이티브 프로브에 Runner 관리, 상태 관찰, 터미널, 로그, 환경설정 및 복원 도우미를 추가합니다. 기능 검증을 숨겨진 창에서 실행하고 화면 표시와 실제 입력 검증은 별도로 유지합니다.

## 2. Work Plan
- Trace the existing DOM handlers, native observation contracts, and isolated restart lifecycle.
- Compose feature-specific helpers through HubActions and migrate overlapping native consumers.
- Run focused checks and representative hidden Windows cases with the installed Runner, then document commands, examples, and remaining observation boundaries.

## 3. Work Summary
- Composed Runner tabs, application settings, mounted Runner and Work observations, xterm, and Hub logs through HubActions. Actions use ordinary DOM handlers. Reads reuse exact mounted tab bindings, native session generations, and product preference and log owners.
- Migrated native configuration, terminal, log, language, Work, attachment, image, and IssueRun consumers where they overlapped. The native CLI now shares case registration and selection across both entry points, retaining their smoke and installation defaults.
- Added hidden workspace and terminal command coverage and separated hidden log and language checks from their presentation selections. Restart evidence now verifies the original background window before teardown and the replacement window after restart.
- Updated the native probe guide with background-first selection, reusable examples, and presentation and trusted-input evidence boundaries. The exact Project policy index was absent. All implementation changes are in tests, test tooling, or their documentation.

## 4. Validation Evidence
- Windows installed Runner workspace case passed in `temp/native-probe/6c30f87f-e5bb-49b9-a510-ed8803a1b883/background-workspace/evidence.json`. It verified distinct tab and PTY identities, rename, reorder, shortcut navigation, two settled PTY replacements, restored tab order and preferences, cancellation and confirmation, and native exit of the removed Runner with an unsent draft. Both fixture Hub processes remained hidden at the observed checkpoints and had no observed activation.
- Windows `terminal-commands`, `hub-log`, `language-preference`, and `configuration-selection` passed in `temp/native-probe/d54133af-6626-48a6-91c8-513206ae6e48/`. The probe observed installed Runner help and matching invalid-argument output, retained xterm scrollback, live log append and pagination, ordered native history after restart, and preferences and configuration through their controls. All four cases completed hidden with no observed activation and released resources. The installed Runner returned `RUNNER_COMMAND_USAGE_INVALID`. The log check set the viewport at the bottom before checking that a subsequent append advanced it.
- Windows `runner-read-only` passed in `temp/native-probe/50d948d2-57ab-4407-a4f5-515b1dc8cee8/runner-read-only/evidence.json`. Native builds passed TypeScript/Vite, the ordinary Rust library check, and the ordinary dependency graph check.
- Windows `preview-views` and `generated-consumer` passed in `temp/native-probe/d7e22b10-0bdc-4e4d-9eb6-e7beba1c2694/`. Hidden attachment and synthetic generated-image checks passed with no observed activation and clean release. The generated consumer bound the selected tab to its mounted Runner before checking image bytes and preview controls.
- 41 focused Node checks and 21 focused headless scenarios passed. The headless fixtures covered canonical running, attention, success, failure, interruption, uncertainty, reuse, delayed removal settlement, configuration, and attachment owner isolation. Earlier broader headless selection timed out with four stale WG2 cases invoking obsolete `navigation.intent` and three stale workspace child-list expectations. The corrected child-list assertions passed on focused rerun. The WG2 failures are outside the migrated helper paths.
- Displayed terminal and composer layout, rendered language and log appearance, and GIF frames retain separate presentation selections. Native Ctrl+F behavior, trusted input, physical clipboard and drag, genuine image provenance, and macOS acceptance remain unverified in this task. Work state scenarios used fixtures and installed Runner cases used read-only commands.

## 5. User Verification Message
- Run `npm run test:native:probe -- --help` to select a case. For representative hidden Windows validation, select `background-workspace`, `terminal-commands`, or `hub-log` and pass `--runner-root` with the normally installed Runner Workspace. See [native probe usage](../tools/native-probe/README.md) for composition examples and the evidence required for displayed and trusted-input scenarios.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"265","task_workload_id":"5154ecc313814fe4860bfebebe938b27"}
<!-- TASK_END_RUNTIME_METADATA_END -->
