use super::*;
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
fn queued_and_interaction_are_not_committed_settings() {
    let mut protocol = ready();
    let wire = protocol.request(Some("/model".into()), "private-key").unwrap();
    assert!(String::from_utf8(wire).unwrap().contains("private-key"));
    protocol.response(packet(2, "accepted", "queued")).unwrap();
    assert_eq!(protocol.snapshot.results[0].state, "queued");
    assert_eq!(protocol.snapshot.observation.as_ref().unwrap().selection.model, "m");
    protocol.response(packet(2, "pending-interaction", "awaiting_interaction")).unwrap();
    assert_eq!(protocol.snapshot.results[0].state, "pending-interaction");
    protocol.response(packet(2, "accepted", "completed")).unwrap();
    assert_eq!(protocol.snapshot.results[0].state, "accepted");
    assert_eq!(protocol.snapshot.observation.as_ref().unwrap().selection.model, "m");
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
fn malformed_or_cross_session_responses_do_not_change_canonical_state() {
    for mutation in ["session_id", "process_id", "connection_id", "phase"] {
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
