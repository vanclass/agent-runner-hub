# Session Report

## 1. Task Info
- Task Number: 291
- Task Title: Event-driven Runner synchronization in Hub
- Task Title (KR): Hub의 이벤트 기반 Runner 동기화
- Summary: Use authenticated Local Control events and native notifications to synchronize Runner information and retain authoritative operation receipts.
- Summary (KR): 인증된 Local Control 이벤트와 네이티브 알림으로 Runner 정보를 동기화하고 작업 결과를 유지합니다.

## 2. Work Plan
- Use the Local Control contracts from tasks 6165 and 6167 to establish connection-scoped delivery, initial acquisition, and bounded reconciliation.
- Route snapshots and receipts through native notifications. Keep Work revisions, recovery state, images, Brief and Run receipts, and Provider notifications with their respective consumers.
- Remove migrated retrieval schedules and update focused tests and specifications. Check representative delivery and operation behavior against the configured Runner where available.

## 3. Work Summary
- The native Local Control worker owns queries, event subscriptions and commands on the authenticated pipes. Since hello does not advertise topics, one discovery observation identifies coverage. Hub acquires its baseline after subscription and receives snapshots, operation receipts and validated events through the existing PTY IPC channel.
- `RunnerControl` distributes notifications. `RunnerConfigService` retains the quick settings catalogs. `RunnerWork` merges initial pages, pushed revisions and operation receipts. `RunnerRecovery` owns the connected context, `RunnerImages` owns lazy inventory and verified content, and `RunnerBrief` and `RunnerTypedRun` own staging and Run receipt correlation. `RunnerProviderEvents` publishes Provider observations and coverage loss independently of Work and operation outcomes.
- Removed periodic snapshot and Runner observe retrieval, Work discovery and status polling, recovery refresh scheduling, timed image discovery, and Brief/Run initiation polling. Invalidation reads share pending work and retain changes received during retrieval. Incomplete delivery retires coverage and starts bounded reconciliation. A successor connection establishes its own subscription.
- Remaining reads are initial or invalidation-driven queries, pagination and selected image chunks, explicit inventory checks, and exact observation or status reads required to verify a user operation. Receipt deadlines and the native pipe service loop send no periodic information requests. Terminal output keeps its existing data path.
- Consulted the AgentRunnerHub project policy index and information retrieval policy, and the Runner Local Control contracts delivered by tasks 6165 and 6167.

## 4. Validation Evidence
- TypeScript and Vite build passed. The native control-focused tests passed 100 cases, including subscribe-before-baseline, invalidation during observation, and sequence-gap retirement.
- Two inherited-pipe fixture tests passed after updating their observation assertions for event delivery. They covered successor subscription, foreground invalidation, observation rejection diagnostics, and uncertainty at EOF.
- The configured Windows Runner passed native command delivery and cancellation, two isolated sessions, owned shutdown, and unchanged observation serial through a 1.3-second idle window. The configured Codex Test account probe verified settings receipts, one Work submission, a correlated Work notification and authoritative status, and an unknown result for the same request ID in the other session.
- Eleven focused Chromium checks passed using the existing browser fixture. They covered a 31-second idle interval without recurring requests, missed Work revision reconciliation, effective settings changes, a connected recovery reference, a verified image preview, correlated Brief/Run delivery, and Provider notification delivery without Work settlement. They also exercised attachment staging, confirmation cancellation, and unread Work activity.
- A three-case follow-up passed event reconciliation, spare promotion readiness and restart resumption after authenticated observation coverage returned. Changed tracked files retained UTF-8 and LF.
- Live generated image creation, live recovery and Brief/Run changes, actual Provider notification delivery to a native renderer, and actual overflow were outside the executed native probes. Their consumer behavior was exercised with fixtures where applicable. Provider completion and Work terminal settlement were not asserted by the live Work probe.

## 5. User Verification Message
- Hub now uses the authenticated Runner event subscription for routine synchronization. The configured Windows Runner and focused browser checks verified representative delivery, updates and operation receipts. The validation notes distinguish live Runner evidence from fixture coverage.

<!-- TASK_END_RUNTIME_METADATA_BEGIN -->
artifact_ref_json: {"repository_namespace":"project-d095b183621fc82fa74029d3","task_number":"291","task_workload_id":"ef13f9e4a97d4e929adbba4d75c6852e"}
<!-- TASK_END_RUNTIME_METADATA_END -->
