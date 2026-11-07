use super::*;
fn reference() -> recovery::Reference {
    serde_json::from_value(json!({"version":1,"family":"direct-run","session_id":"retained",
        "generation_id":"generation-1","thread_id":"thread-1","resume_id":"","source_exec_run_id":"exec-1"})).unwrap()
}
fn capable() -> Protocol {
    let mut p = ready();
    p.snapshot.features.recovery = Some(recovery::Capability { version: 1,
        operations: vec!["recovery.reference".into(), "recovery.recover".into()] });
    p
}
fn request() -> features::Request {
    features::Request::Recovery(recovery::Request::Recover { api_version: 1, reference: reference() })
}
#[test]
fn exact_direct_successor_requires_owned_process_reference_and_original_final_result() {
    let mut p = capable();
    p.feature_request(request(), "private").unwrap();
    let original = p.next;
    p.response(packet(original, "accepted", "queued")).unwrap();
    let mut successor = hello();
    successor["session_id"] = json!("retained");
    successor["connection_id"] = json!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let mut crossed = successor.clone(); crossed["process_id"] = json!(43);
    assert!(p.successor_hello(&crossed).is_err());
    let mut crossed = successor.clone(); crossed["session_id"] = json!("other");
    assert!(p.successor_hello(&crossed).is_err());
    p.successor_hello(&successor).unwrap();
    assert_eq!(p.next, original);
    assert_eq!(p.snapshot.features.results.last().unwrap().state, "queued");
    assert_eq!(p.snapshot.state, "connecting");
    let mut final_result = packet(original, "accepted", "completed");
    final_result["session_id"] = successor["session_id"].clone();
    final_result["connection_id"] = successor["connection_id"].clone();
    final_result["reference"] = serde_json::to_value(reference()).unwrap();
    final_result["recovery_status"] = json!("recovered");
    final_result["outcome_unknown"] = json!(false);
    p.response(final_result).unwrap();
    assert_eq!(p.snapshot.features.results.last().unwrap().state, "accepted");
    let bytes = p.request(None, "private").unwrap();
    let next: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(next["session_id"], "retained");
    assert_eq!(next["request_id"], original + 1);
    assert!(p.successor_hello(&successor).is_err());
}
#[test]
fn recovery_rejects_crossed_or_uncertain_success_and_does_not_promote_eof() {
    let mut p = capable(); p.feature_request(request(), "private").unwrap();
    let mut result = packet(p.next, "accepted", "completed");
    result["reference"] = serde_json::to_value(reference()).unwrap();
    result["recovery_status"] = json!("recovered"); result["outcome_unknown"] = json!(true);
    assert!(p.response(result).is_err());
    let mut p = capable(); p.feature_request(request(), "private").unwrap();
    p.written_bytes = p.queued_bytes;
    p.disconnect("EOF");
    assert_eq!(p.snapshot.features.results.last().unwrap().state, "outcome-unknown");
}
#[test]
fn recovery_validates_selectors_and_preserves_all_owner_outcomes() {
    for outcome in ["absent", "blocked", "identity_conflict", "interaction_required", "unverified", "partial"] {
        let mut result = packet(1, "rejected", "completed");
        result["reference"] = serde_json::to_value(reference()).unwrap();
        result["recovery_status"] = json!(outcome);
        result["outcome_unknown"] = json!(matches!(outcome, "unverified" | "partial"));
        let features::Request::Recovery(r) = request() else { unreachable!() };
        assert_eq!(r.response(&result).unwrap().recovery_status.as_deref(), Some(outcome));
        result["reference"]["thread_id"] = json!("crossed");
        assert!(r.response(&result).is_err());
    }
    let mut value = serde_json::to_value(reference()).unwrap();
    value["instructions"] = json!("forbidden");
    assert!(serde_json::from_value::<recovery::Reference>(value).is_err());
    let mut p = ready();
    assert!(p.successor_hello(&hello()).is_err());
    assert!(p.feature_request(request(), "private").is_err());
}
