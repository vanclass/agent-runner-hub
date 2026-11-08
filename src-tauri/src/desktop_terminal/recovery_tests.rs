use super::*;
fn lifecycle(reference: recovery::Reference) -> Value {
    let mut result = packet(1, "accepted", "completed");
    result["reference"] = serde_json::to_value(reference).unwrap();
    result["lifecycle_version"] = json!(1); result["disposition"] = json!("completed");
    result["terminal"] = json!(true); result["authoritative"] = json!(true);
    result["ownership"] = json!("available"); result["code"] = json!("");
    result["evidence"] = json!({"owner":"direct_generation", "revision":1,"session_revision":2,
        "sealed":false,"state":"completed","phase":"exited", "digests":{
            "0":"a".repeat(64),"1":"b".repeat(64),"2":"c".repeat(64)}});
    result
}
#[test]
fn recovery_observation_validates_exact_reference_flags_and_nonsecret_evidence() {
    let request = recovery::Request::Observe { api_version: 1, reference: reference() };
    let valid = lifecycle(reference());
    assert!(request.validate().is_ok()); assert!(request.response(&valid).is_ok());
    for (field, value) in [("lifecycle_version", json!(2)), ("terminal", json!(false)),
        ("authoritative", json!(false)), ("ownership", json!("in_use")), ("disposition", json!("unknown")),
        ("evidence", json!({"private_path":"secret"})), ("code", json!("/private/path"))] {
        let mut crossed = valid.clone(); crossed[field] = value;
        assert!(request.response(&crossed).is_err(), "{field}");
    }
    let mut crossed = valid; crossed["reference"]["generation_id"] = json!("other");
    assert!(request.response(&crossed).is_err());
    let mut crossed = lifecycle(reference()); crossed["evidence"]["state"] = json!("running");
    assert!(request.response(&crossed).is_err());
    let mut incomplete = lifecycle(reference());
    incomplete["disposition"] = json!("incomplete"); incomplete["terminal"] = json!(false);
    incomplete["evidence"]["state"] = json!(""); incomplete["evidence"]["phase"] = json!("");
    assert!(request.response(&incomplete).is_ok());
}
fn reference() -> recovery::Reference {
    serde_json::from_value(json!({"version":1,"family":"direct-run","session_id":"retained",
        "generation_id":"generation-1","thread_id":"thread-1","resume_id":"","source_exec_run_id":"exec-1"})).unwrap()
}
#[test]
fn recovery_observation_uses_authenticated_result_correlation_and_legacy_capability() {
    let mut p = capable();
    let observe = features::Request::Recovery(recovery::Request::Observe { api_version: 1, reference: reference() });
    assert!(p.feature_request(observe.clone(), "private").is_err());
    let cap = p.snapshot.features.recovery.as_mut().unwrap();
    cap.lifecycle_version = Some(1); cap.operations.push("recovery.observe".into());
    p.feature_request(observe, "private").unwrap();
    let mut valid = lifecycle(reference()); valid["request_id"] = json!(p.next);
    for (key, value) in [("request_id", json!(99)), ("session_id", json!("other")),
        ("connection_id", json!("wrong")), ("process_id", json!(43))] {
        let mut crossed = valid.clone(); crossed[key] = value;
        assert!(p.response(crossed).is_err(), "{key}");
    }
    p.response(valid.clone()).unwrap();
    assert!(p.response(valid).is_err());
    assert_eq!(p.snapshot.features.results.last().unwrap().operation, "recovery.observe");
}
fn capable() -> Protocol {
    let mut p = ready();
    p.snapshot.features.recovery = Some(recovery::Capability { version: 1,
        lifecycle_version: None,
        operations: vec!["recovery.reference".into(), "recovery.recover".into()] });
    p
}
#[test]
fn lifecycle_capability_is_additive_to_legacy_recovery() {
    let mut value = json!({"version":1,"operations":["recovery.reference","recovery.recover"],
        "reference_version":1,"automatic_retry":false,"instruction_replay":false,
        "families":["direct-run","task-run","issue-run"],
        "outcomes":["recovered","absent","blocked","identity_conflict","interaction_required","unverified","partial"]});
    assert_eq!(recovery::Capability::read(&value).unwrap().lifecycle_version, None);
    value["operations"] = json!(["recovery.reference","recovery.recover","recovery.observe"]);
    value["lifecycle_version"] = json!(1);
    value["lifecycle_dispositions"] = json!(["completed","discarded","suspended","incomplete","in_use","identity_conflict","absent","unverified"]);
    assert_eq!(recovery::Capability::read(&value).unwrap().lifecycle_version, Some(1));
    value["lifecycle_version"] = json!(2);
    let legacy = recovery::Capability::read(&value).unwrap();
    assert_eq!(legacy.operations, vec!["recovery.reference", "recovery.recover"]);
}
fn request() -> features::Request {
    features::Request::Recovery(recovery::Request::Recover { api_version: 1, reference: reference() })
}
#[test]
fn lifecycle_accepts_family_owned_terminal_and_uncertain_results() {
    for (reference, owner, extra) in [
        (json!({"version":1,"family":"task-run","repository_namespace":"project","task_number":"1","task_workload_id":"exact"}), "task_workload", json!({"1":"b".repeat(64)})),
        (json!({"version":1,"family":"issue-run","issue_run_id":"issue","created_by_runner_session_id":"origin","creation_provenance_digest":"digest"}), "issue_lifecycle", json!({}))] {
        let reference: recovery::Reference = serde_json::from_value(reference).unwrap();
        let request = recovery::Request::Observe { api_version: 1, reference: reference.clone() };
        for disposition in ["completed", "discarded", "suspended", "incomplete", "in_use", "identity_conflict", "absent", "unverified"] {
            let mut result = lifecycle(reference.clone());
            let verified = !matches!(disposition, "identity_conflict" | "absent" | "unverified");
            result["disposition"] = json!(disposition); result["terminal"] = json!(matches!(disposition, "completed" | "discarded"));
            result["authoritative"] = json!(verified);
            result["ownership"] = json!(if disposition == "in_use" { "in_use" } else if verified { "available" } else { "unavailable" });
            let mut digests = json!({"0":"a".repeat(64)});
            digests.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            result["evidence"] = if verified { json!({"owner":owner,"revision":1,"state":"fixture","phase":"fixture","digests":digests}) } else { Value::Null };
            if matches!(disposition, "completed" | "discarded") {
                result["evidence"]["state"] = json!(if disposition == "discarded" { "aborted" }
                    else if owner == "issue_lifecycle" { "finalized" } else { "completed" });
            }
            if verified && owner == "issue_lifecycle" { result["evidence"]["ownership_revision"] = json!(2); }
            assert!(request.response(&result).is_ok(), "{disposition}");
        }
    }
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
