use super::*;
fn capability() -> Value {
    json!({"version":1,"operations":["run.invoke","run.status"],"run_modes":["issue-run"],
        "observation_lifetime":"process_session","automatic_retry":false,"receipt":"request_accepted"})
}
fn invoke() -> features::Request { features::Request::Run(run::Request::Invoke { api_version:1 }) }
fn status(original: u64) -> features::Request {
    features::Request::Run(run::Request::Status { api_version:1, invocation_request_id:original })
}
fn response(id: u64, original: u64, started: bool) -> Value {
    let mut reply = packet(id, "accepted", "completed");
    reply["receipt"] = json!("request_accepted");
    reply["run"] = json!({"invocation_request_id":original,"request_status":"accepted",
        "initiation_status":if started {"started"} else {"pending"},"dispatch_status":"dispatching",
        "issue_run_id":if started {"issue-1"} else {""},"authority_digest":if started {"a".repeat(64)} else {String::new()},
        "state_revision":if started {1} else {0},"lifecycle_status":if started {"running"} else {""},
        "lifecycle_terminal":false,"terminal_reason":"","outcome":"","owner_status":"","outcome_unknown":false});
    reply
}
fn run_ready() -> Protocol {
    let mut p = ready(); p.snapshot.features.discover(&json!({"run":capability()})); p
}
#[test]
fn run_capability_and_request_admission_are_contract_gated() {
    let mut p = ready(); assert!(p.feature_request(invoke(), "key").is_err());
    for field in ["version", "operations", "run_modes", "observation_lifetime", "automatic_retry", "receipt"] {
        let mut cap = capability(); cap[field] = json!(null);
        p.snapshot.features.discover(&json!({"run":cap})); assert!(p.feature_request(invoke(), "key").is_err());
    }
    p = run_ready(); assert!(p.feature_request(status(99), "key").is_err());
    assert!(serde_json::from_value::<run::Request>(json!({"operation":"run.invoke","api_version":1,"body":"forbidden"})).is_err());
    p.feature_request(invoke(), "key").unwrap();
    p.snapshot.features.discover(&json!({"run":{"version":2}}));
    assert!(p.feature_request(status(2), "key").is_err());
}
#[test]
fn run_acceptance_is_not_start_and_status_is_independent_of_execution() {
    let mut p = run_ready();
    let wire: Value = serde_json::from_slice(&p.feature_request(invoke(), "key").unwrap()).unwrap();
    assert_eq!(wire["operation"], "run.invoke"); assert!(wire.get("command").is_none());
    p.response(response(2, 2, false)).unwrap();
    assert!(p.pending.is_empty());
    for started in [false, false, true] {
        let wire: Value = serde_json::from_slice(&p.feature_request(status(2), "key").unwrap()).unwrap();
        assert_eq!(wire["invocation_request_id"], 2); assert_eq!(wire["session_id"], "expected");
        p.response(response(p.next, 2, started)).unwrap();
        assert!(!p.expired()); assert!(p.pending.is_empty());
    }
    assert!(p.snapshot.results.is_empty());
    assert_eq!(p.snapshot.features.results.iter().filter(|r| r.operation == "run.invoke").count(), 1);
}
#[test]
fn run_correlation_malformed_authority_and_transport_loss_fail_closed() {
    for field in ["process_id", "session_id", "connection_id", "request_id", "invocation_request_id", "authority_digest", "state_revision"] {
        let mut p = run_ready(); p.feature_request(invoke(), "key").unwrap(); p.response(response(2, 2, false)).unwrap();
        p.feature_request(status(2), "key").unwrap();
        p.written_bytes = p.queued_bytes;
        let mut reply = response(3, 2, true);
        match field { "invocation_request_id" => reply["run"][field] = json!(99),
            "authority_digest" => reply["run"][field] = json!(""), "state_revision" => reply["run"][field] = json!(0),
            _ => reply[field] = json!("crossed") }
        assert!(p.response(reply).is_err(), "{field}"); p.disconnect("invalid response");
        assert_eq!(p.snapshot.features.results.last().unwrap().state, "outcome-unknown");
    }
    let mut p = run_ready(); p.feature_request(invoke(), "key").unwrap(); p.written_bytes = p.queued_bytes;
    p.disconnect("lost completion"); assert_eq!(p.snapshot.features.results[0].state, "outcome-unknown");
    assert!(p.feature_request(invoke(), "key").is_err());
}
#[test]
fn run_non_start_owner_return_and_post_start_lifecycle_are_distinct() {
    for (initiation, owner, unknown) in [("not_started", "WAITING_FOR_HUMAN", false), ("not_started", "PAUSED", false),
        ("not_started", "REJECTED", false), ("unknown", "SUCCESS", true), ("started", "FAILED", false)] {
        let mut p = run_ready(); p.feature_request(invoke(), "key").unwrap(); p.response(response(2, 2, false)).unwrap();
        p.feature_request(status(2), "key").unwrap();
        let mut reply = response(3, 2, initiation == "started");
        reply["run"]["initiation_status"] = json!(initiation); reply["run"]["dispatch_status"] = json!("returned");
        reply["run"]["owner_status"] = json!(owner); reply["run"]["outcome_unknown"] = json!(unknown);
        if initiation == "started" { reply["run"]["lifecycle_status"] = json!("aborted"); reply["run"]["lifecycle_terminal"] = json!(true); }
        p.response(reply).unwrap();
    }
    let mut p = run_ready(); p.feature_request(invoke(), "key").unwrap();
    let mut rejected = packet(2, "rejected", "completed"); rejected["outcome_unknown"] = json!(false);
    rejected["code"] = json!("RUN_UNAVAILABLE"); p.response(rejected).unwrap();
    assert_eq!(p.snapshot.features.results[0].state, "rejected");
}
