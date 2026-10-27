use super::*;
fn capability() -> Value {
    json!({"version":1,"operations":["session_config.inspect","session_config.plan","session_config.apply"],
        "options_page_size":32,"options_revision":true,"interaction_owner":"runner_terminal","automatic_retry":false})
}
fn configured() -> Protocol {
    let mut protocol = ready();
    protocol.snapshot.features.discover(&json!({"session_config":capability()}));
    protocol
}
fn inspect() -> features::Request {
    features::Request::SessionConfig(session_config::Request::Inspect { api_version:1, account:None,
        offset:0, options_revision:None })
}
fn plan() -> features::Request {
    features::Request::SessionConfig(session_config::Request::Plan { api_version:1,
        desired:session_config::Desired { target:Some("workspace".into()), ..Default::default() } })
}
fn planned(id: u64) -> Value {
    let mut response = packet(id, "accepted", "completed");
    response.as_object_mut().unwrap().extend(json!({"api_version":1,"revision":"a".repeat(64),
        "desired":{"target":"workspace"},"changes":{"target":{"from":"","to":"workspace"}},
        "steps":["target"],"atomic":false,"errors":[],"required_confirmations":[],"impact":{},
        "plan_status":"ready","plan_id":"b".repeat(64)}).as_object().unwrap().clone());
    response
}
#[test]
fn capabilities_require_implemented_version_operations_and_options_guard() {
    let mut protocol = ready();
    assert!(protocol.feature_request(inspect(), "private").is_err());
    for field in ["version", "options_page_size", "interaction_owner", "automatic_retry"] {
        let mut bad = capability(); bad[field] = json!(99);
        protocol.snapshot.features.discover(&json!({"session_config":bad}));
        assert!(protocol.feature_request(inspect(), "private").is_err());
    }
    let mut cap = capability(); cap["operations"] = json!(["session_config.inspect"]); cap["options_revision"] = json!(false);
    protocol.snapshot.features.discover(&json!({"session_config":cap}));
    assert!(protocol.feature_request(plan(), "private").is_err());
    let guarded = features::Request::SessionConfig(session_config::Request::Inspect { api_version:1, account:None,
        offset:32, options_revision:Some("a".repeat(64)) });
    assert!(protocol.feature_request(guarded, "private").is_err());
    assert!(protocol.feature_request(inspect(), "private").is_ok());
}
#[test]
fn typed_requests_reject_extra_fields_bad_evidence_and_boolean_versions() {
    for value in [json!({"operation":"session_config.inspect","api_version":true}),
        json!({"operation":"session_config.plan","api_version":1,"desired":{},"options_revision":"a".repeat(64)}),
        json!({"operation":"session_config.apply","api_version":1,"desired":{},"revision":"bad","plan_id":"b".repeat(64)})] {
        let parsed = serde_json::from_value::<session_config::Request>(value);
        assert!(parsed.is_err() || parsed.unwrap().validate().is_err());
    }
}
#[test]
fn feature_completion_is_not_an_observation_and_keeps_exact_correlation() {
    let mut protocol = configured();
    let first: Value = serde_json::from_slice(&protocol.feature_request(plan(), "private").unwrap()).unwrap();
    let second: Value = serde_json::from_slice(&protocol.feature_request(plan(), "private").unwrap()).unwrap();
    assert_eq!(first["request_id"], 2); assert_eq!(second["request_id"], 3);
    assert_eq!(first["process_id"], 42); assert_eq!(first["session_id"], "expected");
    assert_eq!(first["operation"], "session_config.plan"); assert_eq!(first["api_version"], 1);
    protocol.response(packet(2, "accepted", "queued")).unwrap();
    assert!(protocol.snapshot.features.results[0].reply.is_none());
    protocol.response(packet(2, "pending-interaction", "awaiting_interaction")).unwrap();
    assert_eq!(protocol.snapshot.features.results[0].state, "pending-interaction");
    protocol.response(planned(2)).unwrap();
    assert_eq!(protocol.snapshot.state, "ready"); assert_eq!(protocol.snapshot.observation_serial, 1);
    assert_eq!(protocol.snapshot.features.results[0].state, "accepted");
    assert_eq!(protocol.snapshot.features.results[1].state, "sending");
    protocol.response(planned(3)).unwrap();
    assert!(protocol.pending.is_empty());
    let public = serde_json::to_value(protocol.public_snapshot()).unwrap().to_string();
    assert!(!public.contains("private")); assert!(!public.contains("connection_id")); assert!(!public.contains("session_id"));
}
#[test]
fn rejected_feature_request_does_not_close_a_healthy_control_channel() {
    let mut protocol = configured(); protocol.feature_request(inspect(), "private").unwrap();
    let mut rejected = packet(2, "rejected", "completed");
    rejected.as_object_mut().unwrap().remove("phase"); rejected["code"] = json!("INVALID_SESSION_CONFIG_REQUEST");
    protocol.response(rejected).unwrap();
    assert_eq!(protocol.snapshot.features.results[0].admission, "rejected");
    assert_eq!(protocol.snapshot.state, "ready");
    protocol.request(None, "private").unwrap();
    let mut observed = packet(3, "accepted", "completed"); observed["observation"] = observation();
    protocol.response(observed).unwrap(); assert_eq!(protocol.snapshot.observation_serial, 2);
}
#[test]
fn disconnect_distinguishes_no_bytes_from_partial_transmission_and_admission() {
    for mode in 0..3 {
        let mut protocol = configured(); protocol.feature_request(inspect(), "private").unwrap();
        protocol.written_bytes = protocol.pending[&2].wire_start + if mode == 1 { 1 } else { 0 };
        if mode == 2 { protocol.response(packet(2, "accepted", "queued")).unwrap(); }
        protocol.disconnect("EOF");
        assert_eq!(protocol.snapshot.features.results[0].state, if mode == 0 { "not-sent" } else { "outcome-unknown" });
        assert!(protocol.pending.is_empty());
    }
}
#[test]
fn bounded_feature_waits_do_not_expire_legacy_followers_or_other_sessions() {
    let mut first = configured(); let mut second = configured();
    first.feature_request(inspect(), "private").unwrap(); first.request(Some("/status".into()), "private").unwrap();
    first.pending.get_mut(&2).unwrap().started = Instant::now() - Duration::from_secs(419);
    first.pending.get_mut(&3).unwrap().started = Instant::now() - Duration::from_secs(419);
    assert!(!first.expired());
    second.request(Some("/status".into()), "private").unwrap();
    assert!(!second.expired());
    first.pending.get_mut(&2).unwrap().started = Instant::now() - Duration::from_secs(421);
    assert!(first.expired());
    first.response(packet(2, "pending-interaction", "awaiting_interaction")).unwrap();
    assert!(!first.expired());
    let mut rejected = packet(2, "rejected", "completed"); rejected["api_version"] = json!(1);
    first.response(rejected).unwrap(); assert!(!first.expired());
}
#[test]
fn apply_retains_successful_receipts_after_a_later_unknown_owner_and_disconnect() {
    let mut protocol = configured();
    let request = features::Request::SessionConfig(session_config::Request::Apply { api_version:1,
        desired:session_config::Desired::default(), revision:"a".repeat(64), plan_id:"b".repeat(64) });
    protocol.feature_request(request, "private").unwrap();
    let mut completed = packet(2, "failure", "completed");
    completed.as_object_mut().unwrap().extend(json!({"api_version":1,"apply_status":"unknown","atomic":false,
        "outcome_unknown":true,"inspection_unavailable":true,"results":[
            {"setting":"account","outcome":"success","owner_status":"SUCCESS","committed":{"account":{"agent_id":"codex","profile_name":"second"}}},
            {"setting":"model","outcome":"unknown","code":"CONFIG_OWNER_FAILED"},
            {"setting":"target","outcome":"not_attempted"}]}).as_object().unwrap().clone());
    protocol.response(completed).unwrap(); protocol.disconnect("EOF");
    assert_eq!(protocol.snapshot.features.results[0].state, "outcome-unknown");
    let receipt = serde_json::to_value(&protocol.snapshot.features.results[0]).unwrap();
    assert_eq!(receipt["reply"]["results"][0]["outcome"], "success");
    assert_eq!(receipt["reply"]["results"][1]["outcome"], "unknown");
    assert_eq!(receipt["reply"]["results"][2]["outcome"], "not_attempted");
}
