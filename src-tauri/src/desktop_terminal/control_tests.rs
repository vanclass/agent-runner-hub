use super::*;
#[path = "presentation_tests.rs"]
mod presentation_tests;
#[path = "recovery_tests.rs"]
mod recovery_tests;
#[path = "interaction_tests.rs"]
mod interaction_tests;
#[path = "session_config_tests.rs"]
mod session_config_tests;
#[path = "work_tests.rs"]
mod work_tests;
#[path = "brief_tests.rs"]
mod brief_tests;
#[path = "run_tests.rs"]
mod run_tests;
#[path = "reference_tests.rs"]
mod references;
#[cfg(windows)]
#[path = "generated_control_tests.rs"]
mod generated;
fn hello() -> Value {
    json!({"version":1,"process_id":42,"session_id":"expected","connection_id":"0123456789abcdef0123456789abcdef",
        "event":"hello","operations":["observe","command"],"interaction_owner":"runner_terminal"})
}
fn packet(id: u64, status: &str, phase: &str) -> Value {
    let mut value = hello();
    value.as_object_mut().unwrap().remove("event");
    value["request_id"] = json!(id);
    value["status"] = json!(status);
    value["phase"] = json!(phase);
    value
}
fn observation() -> Value {
    json!({"run_mode":"task-run","target":{"binding_state":"bound","owner":"Project","project":"Example"},
        "selection":{"account":"a","model":"m","reasoning_effort":"medium","service_tier":"default",
            "source":"execution","next_model":"next","next_reasoning_effort":"high","next_service_tier":"default"},
        "execution":{"lifecycle_state":"INTERACTIVE_READY","owned_execution_alive":false,"workflow_kind":""},
        "attention":{"foreground_interaction_active":false,"restart_confirmation_required":false,
            "termination_confirmation_active":false,"account_setup_required":false,"awaiting_user_command_reason":"",
            "suspension_status":"","suspension_reason":""},"commands":[]})
}
fn ready() -> Protocol {
    let mut protocol = Protocol::new(42, "expected".into());
    protocol.hello(&hello()).unwrap();
    assert_eq!(protocol.snapshot.state, "connecting");
    protocol.request(None, "private-key").unwrap();
    let mut observed = packet(1, "accepted", "completed");
    observed["observation"] = observation();
    protocol.response(observed).unwrap();
    protocol
}
#[test]
fn optional_user_action_preserves_old_observations_and_opaque_fields() {
    let old: Observation = serde_json::from_value(observation()).unwrap();
    assert!(old.issue_run_user_action.is_none());
    let mut full = observation();
    full["issue_run_user_action"] = json!({"schema_version":"issue-run-user-action-v1",
        "status":"required", "issue_run_id":"ir", "state_revision":7,
        "requirements":[{"kind":"approval","request_key":"","request_version":"","question":"private"}]});
    let decoded: Observation = serde_json::from_value(full.clone()).unwrap();
    assert_eq!(decoded.issue_run_user_action.as_ref().unwrap().state_revision, Some(7));
    assert!(!serde_json::to_string(&decoded).unwrap().contains("private"));
    full["issue_run_user_action"] = json!({"status":"required"});
    let decoded: Observation = serde_json::from_value(full).unwrap();
    assert_eq!(decoded.issue_run_user_action.unwrap().status, "unknown");
}
#[test]
fn issue_execution_projection_is_optional_and_excludes_private_fields() {
    let mut payload = observation();
    assert!(serde_json::from_value::<Observation>(payload.clone()).unwrap().issue_run_execution.is_none());
    payload["issue_run_execution"] = json!({
        "schema_version":"issue-run-execution-v1", "status":"running", "issue_run_id":"ir-1", "state_revision":5,
        "interpreter":{"invocation_id":"main", "launch_generation":2, "thread_id":"thread", "turn_id":"turn",
            "instance_id":"instance", "opaque":"private"}
    });
    let view = serde_json::from_value::<Observation>(payload.clone()).unwrap();
    assert_eq!(view.issue_run_execution.as_ref().unwrap().interpreter.as_ref().unwrap().launch_generation, 2);
    assert!(!serde_json::to_string(&view).unwrap().contains("private"));
    payload["issue_run_execution"]["interpreter"]["launch_generation"] = json!("bad");
    let malformed = serde_json::from_value::<Observation>(payload).unwrap().issue_run_execution.unwrap();
    assert_eq!(malformed.status, "unknown");
    assert!(malformed.schema_version.is_empty());
}
#[test]
fn issue_observation_binds_live_interpreter_and_handles_incomplete_native_fields() {
    let mut protocol = ready();
    assert!(protocol.public_snapshot().observation.unwrap().issue_run_execution.is_none());
    protocol.request(None, "private").unwrap();
    let mut live = packet(2, "accepted", "completed");
    live["observation"] = observation();
    live["observation"]["run_mode"] = json!("issue-run");
    live["observation"]["issue_run_execution"] = json!({
        "schema_version":"issue-run-execution-v1", "status":"running", "issue_run_id":"ir",
        "state_revision":5, "interpreter":{"invocation_id":"invocation","instance_id":"instance",
            "launch_generation":2,"thread_id":"thread","turn_id":"turn"}
    });
    let mut crossed = live.clone();
    crossed["session_id"] = json!("different");
    assert!(protocol.response(crossed).is_err());
    assert!(protocol.public_snapshot().observation.unwrap().issue_run_execution.is_none());
    protocol.response(live).unwrap();
    let signal = protocol.public_snapshot().observation.unwrap().issue_run_execution.unwrap();
    assert_eq!((signal.status.as_str(), signal.state_revision), ("running", Some(5)));

    let mut unbound = observation();
    unbound["issue_run_user_action"] = json!({"schema_version":"issue-run-user-action-v1",
        "status":"not_required", "issue_run_id":"", "requirements":[]});
    unbound["issue_run_execution"] = json!({"schema_version":"issue-run-execution-v1",
        "status":"idle", "issue_run_id":"", "state_revision":null});
    let partial: Observation = serde_json::from_value(unbound.clone()).unwrap();
    assert_eq!(partial.issue_run_user_action.unwrap().status, "unknown");
    assert_eq!(partial.issue_run_execution.unwrap().status, "unknown");
    unbound["issue_run_user_action"]["state_revision"] = Value::Null;
    unbound["issue_run_execution"]["interpreter"] = Value::Null;
    let complete: Observation = serde_json::from_value(unbound).unwrap();
    assert_eq!(complete.issue_run_user_action.unwrap().status, "not_required");
    assert_eq!(complete.issue_run_execution.unwrap().status, "idle");
}
#[test]
fn hello_binds_the_actual_created_process_and_expected_session() {
    for field in ["process_id", "session_id", "version", "connection_id"] {
        let mut changed = hello(); changed[field] = json!("stale");
        assert!(Protocol::new(42, "expected".into()).hello(&changed).is_err());
    }
    assert_eq!(ready().snapshot.state, "ready");
}

#[test]
fn partial_observation_retires_full_view_without_disconnect_and_can_recover() {
    let mut protocol = ready();
    protocol.request(None, "private").unwrap();
    let mut partial = packet(2, "accepted", "completed");
    partial["observation"] = json!({"observation_unavailable":true,
        "issue_run_user_action":{"schema_version":"issue-run-user-action-v1","status":"unknown"}});
    protocol.response(partial).unwrap();
    assert!(protocol.connection.is_some());
    assert_eq!(protocol.snapshot.state, "ready");
    assert!(protocol.public_snapshot().observation.is_none());
    assert!(protocol.public_snapshot().observation_age_ms.is_none());
    assert!(protocol.request(Some("/status".into()), "private").is_err());
    assert!(protocol.feature_request(features::Request::Work(work::Request::Submit {
        api_version: 1, instruction: "must not submit".into(),
    }), "private").is_err());
    assert!(protocol.feature_request(features::Request::Recovery(recovery::Request::Reference {
        api_version: 1, observation_id: "terminal:1".into(),
    }), "private").is_err());
    protocol.request(None, "private").unwrap();
    let mut full = packet(3, "accepted", "completed");
    full["observation"] = observation();
    protocol.response(full).unwrap();
    assert!(protocol.public_snapshot().observation.is_some());
    assert!(protocol.public_snapshot().observation_age_ms.is_some());
}
#[test]
fn unavailable_command_observation_preserves_acknowledgement_and_retires_freshness() {
    let mut p = ready();
    p.request(Some("/status".into()), "private").unwrap();
    let mut completed = packet(2, "accepted", "completed");
    completed["observation_unavailable"] = json!(true);
    p.response(completed).unwrap();
    assert_eq!(p.snapshot.results.last().unwrap().state, "accepted");
    assert!(p.snapshot.observation.is_none());
    assert!(p.observed_at.is_none());
    assert!(p.connection.is_some());
    assert!(p.request(None, "private").is_ok());
}
#[test]
fn rejected_observations_retain_only_authenticated_sanitized_failure_evidence() {
    for (status, phase, code) in [("rejected", Some("completed"), "SESSION_NOT_READY"),
        ("failure", Some("completed"), "DISPATCH_FAILED"), ("failure", Some("completed"), "SESSION_CLOSED"),
        ("rejected", None, "AUTHENTICATION_FAILED"), ("rejected", None, "SESSION_IDENTITY_MISMATCH")] {
        let mut p = ready();
        let generation = p.snapshot.features.generation;
        p.request(None, "private").unwrap();
        let mut reply = packet(2, status, "completed");
        if phase.is_none() { reply.as_object_mut().unwrap().remove("phase"); }
        reply["code"] = json!(code);
        reply["message"] = json!("private diagnostic must not escape");
        reply["observation"] = observation();
        let error = p.response(reply).unwrap_err();
        p.disconnect(error);
        let snapshot = p.public_snapshot();
        let failure = snapshot.observation_failure.as_ref().unwrap();
        assert_eq!((failure.request_id, failure.status.as_str(), failure.phase.as_deref(), failure.code.as_deref()),
            (2, status, phase, Some(code)));
        assert_eq!(snapshot.state, "disconnected");
        assert_eq!(snapshot.observation_serial, 1);
        assert_eq!(snapshot.features.generation, generation);
        assert!(snapshot.detail.as_ref().unwrap().contains(code));
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("private"));
        assert!(p.pending.is_empty());
        assert!(p.feature_request(features::Request::Work(work::Request::Submit {
            api_version: 1, instruction: "must not submit".into(),
        }), "private").is_err());
        assert!(p.feature_request(features::Request::Recovery(recovery::Request::Reference {
            api_version: 1, observation_id: "api:559".into(),
        }), "private").is_err());
    }
}
#[test]
fn observation_freshness_advances_only_on_authenticated_completed_observations() {
    let mut protocol = ready();
    let first = protocol.public_snapshot();
    assert_eq!(first.observation_serial, 1);
    assert!(first.observation_age_ms.is_some());
    protocol.observed_at = Some(Instant::now() - Duration::from_secs(5));
    assert!(protocol.public_snapshot().observation_age_ms.unwrap() >= 5000);
    protocol.request(None, "private").unwrap();
    protocol.response(packet(2, "accepted", "queued")).unwrap();
    assert_eq!(protocol.public_snapshot().observation_serial, 1);
    let mut completed = packet(2, "accepted", "completed");
    completed["observation"] = observation();
    protocol.response(completed).unwrap();
    assert_eq!(protocol.public_snapshot().observation_serial, 2);
    assert!(protocol.public_snapshot().observation_age_ms.unwrap() < 1000);
}
#[test]
fn observation_failure_codes_never_publish_raw_text_or_unverified_identity() {
    for code in [json!("private message"), json!("A".repeat(101)), Value::Null] {
        let mut p = ready(); p.request(None, "private").unwrap();
        let mut reply = packet(2, "failure", "completed"); reply["failure_code"] = code;
        let error = p.response(reply).unwrap_err(); p.disconnect(error);
        assert!(p.snapshot.observation_failure.as_ref().unwrap().code.is_none());
        assert!(p.snapshot.detail.as_ref().unwrap().contains("code unavailable"));
    }
    for field in ["version", "process_id", "session_id", "connection_id", "request_id", "phase"] {
        let mut p = ready(); p.request(None, "private").unwrap();
        let mut reply = packet(2, "failure", "completed"); reply[field] = json!("other");
        reply["code"] = json!("UNTRUSTED_CODE");
        let error = p.response(reply).unwrap_err(); p.disconnect(error);
        assert!(p.snapshot.observation_failure.is_none());
        assert!(!p.snapshot.detail.as_ref().unwrap().contains("UNTRUSTED_CODE"));
    }
}
#[test]
fn queued_and_interaction_are_not_committed_settings() {
    let mut protocol = ready();
    let wire = protocol.request(Some("/model".into()), "private-key").unwrap();
    assert!(String::from_utf8(wire).unwrap().contains("private-key"));
    let mut queued = packet(2, "accepted", "queued");
    queued["changed"] = json!(true);
    queued["owner_status"] = json!("SETTINGS_CHANGED");
    queued["observation"] = observation();
    queued["observation"]["selection"]["model"] = json!("not-committed");
    protocol.response(queued).unwrap();
    assert_eq!(protocol.snapshot.results[0].state, "queued");
    assert!(protocol.snapshot.results[0].changed.is_none());
    assert!(protocol.snapshot.results[0].owner_status.is_none());
    assert_eq!(protocol.snapshot.observation.as_ref().unwrap().selection.model, "m");
    protocol.response(packet(2, "pending-interaction", "awaiting_interaction")).unwrap();
    assert_eq!(protocol.snapshot.results[0].state, "pending-interaction");
    let mut completed = packet(2, "accepted", "completed");
    completed["owner_status"] = json!("SETTINGS_CHANGED");
    completed["changed"] = json!(true);
    completed["settings_change_count"] = json!(1);
    completed["observation"] = observation();
    completed["observation"]["selection"]["model"] = json!("owner-confirmed");
    protocol.response(completed).unwrap();
    assert_eq!(protocol.snapshot.results[0].state, "accepted");
    assert_eq!(protocol.snapshot.results[0].changed, Some(json!(true)));
    assert_eq!(protocol.snapshot.results[0].settings_change_count, Some(json!(1)));
    assert_eq!(protocol.snapshot.observation.as_ref().unwrap().selection.model, "owner-confirmed");
    let public = serde_json::to_string(&protocol.snapshot).unwrap();
    for private in ["private-key", "process_id", "session_id", "connection_id"] { assert!(!public.contains(private)); }
}
#[test]
fn unknown_observation_outcome_does_not_commit_an_attached_idle_view() {
    let mut p = ready();
    p.request(Some("/model".into()), "private").unwrap();
    p.request(None, "private").unwrap();
    let mut reply = packet(3, "accepted", "completed");
    reply["outcome_unknown"] = json!(true);
    reply["observation"] = observation();
    let error = p.response(reply).unwrap_err(); p.disconnect(error);
    assert_eq!(p.snapshot.observation_serial, 1);
    assert_eq!(p.snapshot.results[0].state, "outcome-unknown");
    let failure = p.snapshot.observation_failure.as_ref().unwrap();
    assert_eq!(failure.status, "accepted");
    assert!(failure.code.is_none());
}
#[test]
fn rejection_failure_and_uncertainty_remain_distinct_without_replay() {
    for status in ["rejected", "failure"] {
        let mut protocol = ready();
        protocol.request(Some("/unavailable".into()), "private").unwrap();
        protocol.response(packet(2, status, "completed")).unwrap();
        assert_eq!(protocol.snapshot.results[0].state, status);
    }
    let mut protocol = ready();
    protocol.request(Some("/model".into()), "private").unwrap();
    protocol.response(packet(2, "accepted", "queued")).unwrap();
    protocol.disconnect("fixture exit");
    assert_eq!(protocol.snapshot.state, "disconnected");
    assert_eq!(protocol.snapshot.results[0].state, "outcome-unknown");
    assert!(protocol.pending.is_empty());
    assert_eq!(protocol.next, 2);
}
#[test]
fn slash_arguments_retain_exact_wire_text_and_original_request() {
    for command in ["/brief  a brief with   spaces  ", "\t/brief\t  body  ", "/recover --issue-run-id ir-42"] {
        let mut protocol = ready();
        let wire = protocol.request(Some(command.into()), "private").unwrap();
        let packet_value: Value = serde_json::from_slice(&wire).unwrap();
        assert_eq!(packet_value["command"], command);
        let request_id = packet_value["request_id"].as_u64().unwrap();
        protocol.response(packet(request_id, "accepted", "queued")).unwrap();
        assert_eq!(protocol.snapshot.results[0].state, "queued");
        protocol.disconnect("fixture disconnect");
        let result = &protocol.snapshot.results[0];
        assert_eq!(result.id, request_id);
        assert_eq!(result.command, command);
        assert_eq!(result.state, "outcome-unknown");
        assert_eq!(protocol.next, request_id);
    }
}
#[test]
fn malformed_or_cross_session_responses_do_not_change_canonical_state() {
    for mutation in ["session_id", "process_id", "connection_id", "phase", "observation"] {
        let mut protocol = ready();
        protocol.request(Some("/status".into()), "private").unwrap();
        let mut response = packet(2, "accepted", "completed"); response[mutation] = json!("other");
        assert!(protocol.response(response).is_err());
        assert_eq!(protocol.snapshot.results[0].state, "sending");
        assert_eq!(protocol.snapshot.observation.as_ref().unwrap().selection.model, "m");
    }
    let mut protocol = ready(); protocol.request(None, "private").unwrap();
    let mut malformed = packet(2, "accepted", "completed"); malformed["observation"] = json!({"model":"invented"});
    assert!(protocol.response(malformed).is_err());
}

#[test]
fn foreground_observations_wait_for_terminal_answers_without_timing_out() {
    let mut protocol = ready();
    protocol.request(None, "private").unwrap();
    protocol.response(packet(2, "pending-interaction", "awaiting_interaction")).unwrap();
    protocol.pending.get_mut(&2).unwrap().started = Instant::now() - Duration::from_secs(120);
    assert!(!protocol.expired());
}
