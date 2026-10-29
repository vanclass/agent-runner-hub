use super::*;
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
fn hello_binds_the_actual_created_process_and_expected_session() {
    for field in ["process_id", "session_id", "version", "connection_id"] {
        let mut changed = hello(); changed[field] = json!("stale");
        assert!(Protocol::new(42, "expected".into()).hello(&changed).is_err());
    }
    assert_eq!(ready().snapshot.state, "ready");
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
