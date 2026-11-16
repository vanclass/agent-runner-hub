use super::*;
use std::sync::mpsc;
fn capability() -> Value {
    json!({"version":1,"delivery":"pull","read_only":true,"lifetime":"process_session",
        "operations":["presentation.subscribe","presentation.read","presentation.unsubscribe"]})
}
fn subscribe() -> presentation::Request { presentation::Request::Subscribe { api_version: 1, types: vec!["log".into(), "activity".into()] } }
#[test]
fn discovers_only_supported_pull_contract() {
    assert!(presentation::supported(&capability()));
    for field in ["version", "delivery", "lifetime", "read_only", "operations"] {
        let mut cap = capability(); cap[field] = Value::Null;
        assert!(!presentation::supported(&cap));
    }
}
#[test]
fn authenticated_observation_discovers_presentation_without_command_results() {
    let mut p = ready();
    p.request(None, "private").unwrap();
    let mut reply = packet(p.next, "accepted", "completed");
    reply["observation"] = observation(); reply["capabilities"]["presentation"] = capability();
    p.response(reply).unwrap();
    assert!(p.public_snapshot().presentation_supported);
    assert!(p.snapshot.results.is_empty());
}
#[test]
fn presentation_requests_are_authenticated_generation_bound_and_independent() {
    let mut p = ready(); p.snapshot.presentation_supported = true;
    let generation = p.snapshot.features.generation;
    let (send, receive) = mpsc::channel();
    assert!(p.presentation_request(subscribe(), generation + 1, send.clone(), "private").is_err());
    let wire: Value = serde_json::from_slice(&p.presentation_request(subscribe(), generation, send, "private").unwrap()).unwrap();
    assert_eq!(wire["operation"], "presentation.subscribe");
    assert_eq!(wire["key"], "private"); assert_eq!(wire["session_id"], "expected");
    let id = p.next;
    p.request(Some("/help".into()), "private").unwrap(); let command = p.next;
    let mut reply = packet(id, "accepted", "completed");
    reply["api_version"] = json!(1); reply["stream_id"] = json!("b".repeat(32));
    reply["subscription_id"] = json!("c".repeat(32)); reply["snapshot_sequence"] = json!(9);
    reply["activities"] = json!([]); reply["first_sequence"] = json!(1); reply["closed"] = json!(false);
    let mut stale = reply.clone(); stale["connection_id"] = json!("d".repeat(32));
    assert!(p.response(stale).is_err());
    p.response(reply).unwrap();
    let result = receive.recv().unwrap().unwrap();
    assert!(result.get("connection_id").is_none()); assert!(result.get("key").is_none());
    assert!(p.pending.contains_key(&command)); assert_eq!(p.snapshot.results.len(), 1);
    p.response(packet(command, "accepted", "completed")).unwrap();
    assert_eq!(p.snapshot.results[0].state, "accepted");
}
#[test]
fn presentation_subscription_mismatch_and_disconnect_are_not_success() {
    let request = presentation::Request::Read { api_version: 1, subscription_id: "c".repeat(32), after_sequence: 0 };
    assert!(request.response(&json!({"status":"accepted", "api_version":1,"stream_id":"b".repeat(32),"subscription_id":"d".repeat(32)})).is_err());
    let mut p = ready(); p.snapshot.presentation_supported = true;
    let (send, receive) = mpsc::channel(); let generation = p.snapshot.features.generation;
    p.presentation_request(subscribe(), generation, send, "private").unwrap();
    p.disconnect("closed"); assert!(receive.recv().unwrap().is_err());
    assert!(p.snapshot.results.is_empty());
}
#[test]
fn presentation_read_and_release_validate_without_feature_admission() {
    for request in [presentation::Request::Read { api_version: 1, subscription_id: "c".repeat(32), after_sequence: 123 },
        presentation::Request::Unsubscribe { api_version: 1, subscription_id: "c".repeat(32) }] {
        assert!(request.validate().is_ok());
    }
    let request = presentation::Request::Unsubscribe { api_version: 1, subscription_id: "c".repeat(32) };
    assert_eq!(request.response(&json!({"status":"accepted","unsubscribed":true})).unwrap(), json!({"unsubscribed":true}));
    assert!(request.response(&json!({"status":"accepted","unsubscribed":true,"outcome_unknown":true})).is_err());
    assert!(serde_json::from_value::<presentation::Request>(json!({"operation":"presentation.subscribe","api_version":1,"types":["log","activity"],"command":"/exit"})).is_err());
}
#[test]
fn presentation_timeout_does_not_disconnect_or_starve_ordinary_control() {
    let mut p = ready(); p.snapshot.presentation_supported = true;
    let (send, receive) = mpsc::channel(); let generation = p.snapshot.features.generation;
    p.presentation_request(subscribe(), generation, send, "private").unwrap();
    let expired = p.next;
    p.pending.get_mut(&expired).unwrap().started = Instant::now() - COMPLETION_TIMEOUT - Duration::from_secs(1);
    p.expire_presentations();
    assert!(receive.recv().unwrap().is_err()); assert!(!p.expired());
    assert!(!p.has_unsettled_requests()); assert_eq!(p.snapshot.state, "ready");
    p.request(Some("/help".into()), "private").unwrap();
    p.response(packet(p.next, "accepted", "completed")).unwrap();
    assert_eq!(p.snapshot.results[0].state, "accepted");
    p.response(packet(expired, "rejected", "completed")).unwrap();
    assert!(p.pending.is_empty());
}
