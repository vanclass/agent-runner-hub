# IssueRun Candidate Report

## Task Info
- Task Number: 246
- Task Title: Verify Windows WebView dialogs and pending setup
- Task Title (KR): Windows WebView 대화상자 및 설치 검증 대기 상태 확인
- Summary: Reconcile R04 Windows dialog observations against the Candidate and document the native pending-backdrop click and successful setup exit.
- Summary (KR): R04의 Windows 대화상자 검증 자료를 현재 후보와 대조하고, 설치 검증 대기 중 배경 클릭과 검증 성공 후 설정 종료를 확인한 근거를 기록한다.

## Work
- Pre-implementation plan. Map the retained browser and Windows observations to each R04 property. Check the Candidate source and compare the pending click, the samples that bracket it, and the real resolver lifetime. Use an isolated Windows fixture only if a property still needs direct corroboration.
- Compared the retained ir-109 evidence against AgentRunnerHub Candidate `92e3d12565a4795db59edd45f293be8ba63c45c7`. Of the 70 inputs recorded by the Windows renderer fixture, 69 match byte for byte. The only renderer difference adds the optional `ControlSnapshot.observationFailure` type field. The native control protocol delta concerns observation failure reporting. The required-dialog guard, installation resolver, and success transition are source-applicable to the retained run.
- The ir-109 WG-02 Chromium regression distinguishes the replacement dismiss callback from the original after an outside press and rerender. The pass followed a correction to the closed-dialog diagnostic locator. Its scope is browser callback behavior. The Windows observations below come from the native fixtures. Only this report changed in the Candidate.

## Validation

| R04 property | Disposition and evidence |
| --- | --- |
| Attached image | WG-03 `native-plain-2` used a synthetic PNG through native clipboard paste and the production attachment opener. Interior and padding clicks retained the dialog. Wheel zoom and captured pan released outside visibly changed the image without dismissal. Backdrop and Escape each closed it and restored focus to the connected opener. |
| Generated image | WG-03 `native-synthetic` used the production generated thumbnail with a fixture-only animated GIF supplied through staged image list/read IPC. It independently observed both dismissals and connected-opener focus returns, interior and padding retention, visible zoom, and captured pan released outside with the viewer retained. This was viewer coverage using synthetic input. |
| Ordinary App Settings | WG-03 `native-plain-2` observed interior and padding retention, backdrop dismissal, Escape and the explicit close path, with opener focus restored. |
| Preview Help | WG-03 `native-plain-2` separately observed interior and padding retention, backdrop dismissal, Escape and the explicit close path, with opener focus restored. |
| Initial and failed required setup | WG-03 `native-plain-2` observed retained setup after both backdrop and Escape before verification and again after a real verification failure. |
| Pending Escape | WG-03 `native-pending` sampled the retained dialog and disabled verification control at 06:45:51.898 UTC after Enter/Escape. Setup had exited by 06:45:52.213. Its backdrop call at 06:46:01.008 arrived too late to test pending protection. |
| Pending backdrop | WG-04 `native-pending-3` supplied the same-window native click and independent observations bracketing it during real verification. See the timing below. |
| Success exit | WG-03 and WG-04 observed required setup disappear and Single Entry appear after successful verification through the original resolver. The WG-04 exit followed release of the timing aid. |
| Shortcut capture | WG-03 `native-plain-2` observed Escape cancel capture, restore the Enter binding and re-enable Apply while retaining the dialog. A second Escape closed the shortcut dialog. |
| Runner removal | WG-03 `native-plain-2` observed the confirmation for a disposable Runner. Escape and Keep tab open each retained it. Explicit Terminate and close tab removed it and recorded shutdown. |

- WG-04 ran at `501ca54a77feffc3bcb7ec67b14f2aae8731f273` on Windows x64 WebView2 157.0.4341.60. Its plain launcher reported renderer and bridge readiness for PID 5916, HWND 10361612. The native input receipt and before, after and exit observations identify that window. The verified backdrop point was client (90, 400), screen (425, 517), at 120 DPI, left of the dialog at x=647.
- On 2026-11-20 UTC, the resolver hold began at 07:32:33.995. The last pre-click check showed required setup and disabled verification at 07:32:36.004. The authorized native click call ran from 07:32:36.044 to 07:32:38.695. The independent check finished at 07:32:39.866 with the same dialog and disabled verification still present. The resolver child recorded release at 07:32:40.383, within its bounded hold. The one-shot wait applied to disposable managed Python and preserved the original resolver result. Success and setup exit are observed through the original path. The native call did not separately capture resolver stdout. The exact probe's stdout was checked off-window.
- WG-03 completed three isolated fixtures with normal exit, settled descendants, released input and removed profiles. The attached-image fixture restored the prior clipboard. Its initial interrupted no-input fixture lacks a normal settlement record. WG-04's first acquisition became stale before input and normal teardown remained unproved, with its original profile retained. Its second attempt skipped the backdrop click when the timing input failed to arm, observed real setup exit, and settled input and the fixture. Its third attempt recorded release, normal exit code 0, no remaining job processes and profile removal. The disposable Runner runtime was removed. The later spare Runner preparation failure occurred after setup exit on the minimal disposable installation.
- Current checks were source and artifact integrity, native timing and identity correlation, and report structure and encoding checks. The invocation diagnostic `r04-evidence-reconciliation.json` indexes the verified original records and Candidate bindings. No fresh Windows interaction was needed on the evidence available to this Worker.

## Review
- R04 is ready for independent Review on the reconciled evidence. The historical WG-04 Worker completed its turn. Its independent acceptance remains unconfirmed. The current Candidate disposition relies on source applicability to the recorded Windows runs. No operator-only action was identified. Runner owns Candidate admission and publication.

<!-- ISSUE_RUN_CANDIDATE_IDENTITY_BEGIN -->
artifact_ref_json: {"schema_version":"issue-run-candidate-report-v3","issue_run_id":"ir-114","work_group_id":"wg-02","generation":1}
<!-- ISSUE_RUN_CANDIDATE_IDENTITY_END -->
