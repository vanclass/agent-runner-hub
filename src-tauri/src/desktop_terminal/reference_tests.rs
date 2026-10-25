use super::*;
use super::super::references::ReferenceRequest;

fn capable() -> Protocol {
    let mut protocol = ready();
    protocol.request(None, "private").unwrap();
    let mut response = packet(2, "accepted", "completed");
    response["observation"] = observation();
    response["capabilities"]["references"] = json!({"version":1,
        "operations":["references.register","references.list"],"batch":false,"inventory_page_size":16,
        "image_details":["auto","low","high","original"],"interaction_owner":"runner_terminal","private_key":"must-not-project"});
    protocol.response(response).unwrap(); protocol
}
fn register(protocol: &mut Protocol) -> u64 {
    let path = std::env::current_dir().unwrap().join("Unicode reference.txt").to_string_lossy().into_owned();
    protocol.reference_request(ReferenceRequest::Register { path }, "private-key").unwrap(); protocol.next
}
fn metadata(index: u64, id: &str) -> Value {
    json!({"reference_id":id,"display_index":index,"display_name":"reference.txt","kind":"file",
        "image_detail":null,"media_kind":null,"source":"private source path"})
}
fn committed(id: u64, stable: &str) -> Value {
    let mut response = packet(id, "accepted", "completed");
    response["registration_status"] = json!("registered");
    response["reference"] = metadata(1, stable);
    response["inventory"] = json!({"total_count":1,"offset":0,"next_offset":null,"references":[metadata(1, stable)]});
    response
}
#[test]
fn reference_capability_requires_completed_authenticated_observation() {
    let mut legacy = ready();
    let next = legacy.next;
    assert!(legacy.reference_request(ReferenceRequest::List { offset: 0 }, "private").is_err());
    assert_eq!(legacy.next, next);
    let mut protocol = Protocol::new(42, "expected".into());
    let mut advertised = hello(); advertised["capabilities"] = json!({"references":{"version":1}});
    protocol.hello(&advertised).unwrap();
    assert!(protocol.snapshot.references.capability.is_none());
    let supported = capable();
    assert_eq!(supported.snapshot.references.capability.unwrap().inventory_page_size, 16);
}
#[test]
fn registration_correlation_never_promotes_admission_or_foreground_interaction() {
    let mut protocol = capable(); let id = register(&mut protocol);
    let mut queued = committed(id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    queued["phase"] = json!("queued");
    protocol.response(queued).unwrap();
    assert_eq!(protocol.snapshot.references.results[0].state, "queued");
    assert!(protocol.snapshot.references.results[0].reference.is_none());
    protocol.response(packet(id, "pending-interaction", "awaiting_interaction")).unwrap();
    assert_eq!(protocol.snapshot.references.results[0].state, "pending-interaction");
    protocol.response(committed(id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).unwrap();
    assert_eq!(protocol.snapshot.references.results[0].state, "registered");
    let second = register(&mut protocol); assert!(second > id);
    protocol.response(committed(second, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).unwrap();
    let results = &protocol.snapshot.references.results;
    assert_eq!(results.len(), 2); assert_ne!(results[0].reference.as_ref().unwrap().reference_id, results[1].reference.as_ref().unwrap().reference_id);
    let public = serde_json::to_string(&protocol.public_snapshot()).unwrap();
    for private in ["private-key", "private source path", "must-not-project", "session_id", "connection_id", "process_id", "Unicode reference.txt"] {
        assert!(!public.contains(private), "{private}");
    }
}
#[test]
fn missing_invalid_or_crossed_registration_receipts_remain_unknown_on_disconnect() {
    for mutation in ["reference_id", "session_id", "registration_status"] {
        let mut protocol = capable(); let id = register(&mut protocol);
        let mut response = committed(id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        if mutation == "reference_id" { response["reference"][mutation] = json!("filename.txt"); }
        else { response[mutation] = json!("invalid"); }
        assert!(protocol.response(response).is_err()); protocol.disconnect("invalid receipt");
        assert_eq!(protocol.snapshot.references.results[0].state, "outcome-unknown");
        assert!(protocol.snapshot.references.results[0].reference.is_none());
        assert_eq!(protocol.next, id);
    }
}
#[test]
fn unknown_rejection_and_failure_do_not_register_or_replay() {
    for state in ["rejected", "failure", "outcome-unknown"] {
        let mut protocol = capable(); let id = register(&mut protocol);
        let mut response = packet(id, if state == "outcome-unknown" { "accepted" } else { state }, "completed");
        response["registration_status"] = json!(if state == "outcome-unknown" { "unknown" } else { "not_registered" });
        response["code"] = json!("REFERENCE_TEST_RESULT"); protocol.response(response).unwrap();
        let result = &protocol.snapshot.references.results[0];
        assert_eq!(result.state, state); assert!(result.reference.is_none()); assert_eq!(protocol.next, id);
        assert_eq!(result.code.as_deref(), Some("REFERENCE_TEST_RESULT"));
    }
    let mut protocol = capable(); let first = register(&mut protocol);
    protocol.response(committed(first, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).unwrap();
    let second = register(&mut protocol); protocol.disconnect("EOF");
    assert_eq!(protocol.snapshot.references.results[0].state, "registered");
    assert_eq!(protocol.snapshot.references.results[1].state, "outcome-unknown"); assert_eq!(protocol.next, second);
}
#[test]
fn paginated_inventory_retains_per_page_order_and_stable_ids() {
    let mut protocol = capable();
    for (offset, count) in [(0, 17), (16, 18)] {
        let wire = protocol.reference_request(ReferenceRequest::List { offset }, "private").unwrap();
        let request: Value = serde_json::from_slice(&wire).unwrap();
        assert_eq!(request["offset"], offset); assert_eq!(request["operation"], "references.list");
        let mut response = packet(protocol.next, "accepted", "completed");
        let end = (offset + 16).min(count);
        response["inventory"] = json!({"offset":offset,"total_count":count,"next_offset":if end < count { Some(end) } else { None },
            "references":(offset..end).map(|n| metadata(n+1, &format!("{n:032x}"))).collect::<Vec<_>>()});
        protocol.response(response).unwrap();
    }
    let pages = &protocol.snapshot.references.results;
    assert_eq!(pages[0].inventory.as_ref().unwrap().next_offset, Some(16));
    assert_eq!(pages[1].inventory.as_ref().unwrap().total_count, 18);
    assert_eq!(pages[1].inventory.as_ref().unwrap().references[0].display_index, 17);
    assert_eq!(pages[1].inventory.as_ref().unwrap().references[0].reference_id, format!("{:032x}", 16));
}

#[test]
fn explicit_unknown_flag_overrides_even_a_failure_without_a_phase() {
    let mut protocol = capable(); let id = register(&mut protocol);
    let mut response = packet(id, "failure", "completed");
    response.as_object_mut().unwrap().remove("phase");
    response["outcome_unknown"] = json!(true);
    protocol.response(response).unwrap();
    let result = &protocol.snapshot.references.results[0];
    assert_eq!(result.state, "outcome-unknown");
    assert!(result.reference.is_none()); assert_eq!(protocol.next, id);
}
