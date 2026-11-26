# Session Report

## 1. Task Info
- Task Number: 260
- Task Title: Align Hub configuration with the effective Runner Provider
- Task Title (KR): Hub 설정을 Runner의 실제 Provider와 일치시키기
- Summary: Use authenticated Provider evidence for Hub selections and read-only test-account discovery.
- Summary (KR): 인증된 Provider 정보를 Hub 선택 항목과 읽기 전용 테스트 계정 조회에 사용한다.

## 2. Work Plan
- Trace the installed Runner observation and Session Configuration contracts into Hub's native adapter, configuration service, and shared selection controls.
- Scope choices and test-account evidence to the verified Provider and owning session while preserving independent preferences and retained work.
- Update the affected specifications and exercise focused frontend, native, and installed Runner checks.

## 3. Work Summary
- Hub now uses authenticated `selection.agent_id` for effective Provider presentation, catalog filtering and configuration checks. Single Entry and Runner tabs expose Provider-qualified account choices and use models from the exact catalog account. Model, reasoning and Fast preferences carry explicit Provider evidence. Incompatible and legacy unqualified preferences remain visible for review. Independent preferences and existing workload authority are preserved.
- Native and frontend test-account discovery require the advertised Provider and an explicit `agent_id`. Replies bind to the requesting session and installation, the exact account, and its canonical `codex_home` or `claude_config_dir`. Discovery is read-only. English and Korean guidance now points to Settings > Test settings.
- Updated the existing Hub preferences and Runner session configuration specifications and their focused test consumers. The project-specific policy index was absent from the task manifest.

## 4. Validation Evidence
- TypeScript checks, the Vite build, and the focused native build passed. Thirteen Session Configuration tests passed, including Claude profile path binding and rejection of crossed identities. The Windows private-pipe fixture separately passed its authenticated round trip with a synthetic Runner.
- Browser fixtures verified both test-account shapes, stale and mismatched evidence, None and missing Provider evidence, preserved independent settings, Codex-to-Claude selection on a fresh tab, and the original Codex tab's retained selections. The final targeted configuration-surface and read-only fixture rerun passed all six cases. The configuration and submission run also passed its affected service assertions. Two parser comparison cases were skipped by their existing prerequisite.
- Installed integration remains unverified. The owned Windows acceptance reached the configured installation but twice disconnected around 30 seconds before any v1 hello. The managed interpreter resolved the installed `src/runner/interactive/session_controller.py`. Its `local_control_available()` returns at line 216 before `channel.start(...)` at line 217. The attach method at line 207 registers the channel without starting it. `session/local_control/transport.py:136` sends the hello from channel startup. This Runner-owned defect blocks authenticated installed Codex and Claude catalog and test-account checks, as well as live None and retained-session checks.
- Separately, the installed Local Control and Session Configuration contracts expose the effective Provider but no configured startup Provider. Hub displays startup Provider as unavailable.
- The localization check reported the existing unused `hubLog.older` and `hubLog.unsaved` keys. The broader browser selection also found attachment staging text and duplicate alert locator failures outside the Provider flow. Focused Provider tests passed after correcting the relevant fixture setup and selectors.

## 5. User Verification Message
- After Runner restores Local Control startup, rerun the installed read-only Session Configuration acceptance against the configured installation. Confirm the effective Provider and its account/model catalog, then verify both configured test accounts through Settings > Test settings. Confirm fresh Codex, Claude and None sessions through Runner's supported controls while preserving retained-session authority.
- A separately authenticated startup Provider field from Runner is required for Hub to display that setting.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"260","task_workload_id":"7c88288538f446d89f8c21737a471165"}
<!-- TASK_END_RUNTIME_METADATA_END -->
