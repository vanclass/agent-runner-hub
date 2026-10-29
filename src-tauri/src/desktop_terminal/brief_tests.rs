use super::*;
fn capability() -> Value {
    json!({"version":1,"operations":["brief.stage"],"run_modes":["issue-run"],
        "lifetime":"process_session","automatic_retry":false})
}
fn request(body: &str) -> features::Request {
    features::Request::Brief(brief::Request::Stage { api_version:1, body:body.into() })
}
fn staged(id: u64) -> Value {
    let mut response = packet(id, "accepted", "completed");
    response["staging_status"] = json!("staged"); response["owner"] = json!("brief_staging");
    response["count"] = json!(1); response["outcome_unknown"] = json!(false); response
}
#[test]
fn brief_capability_is_authenticated_and_validated_without_build_gates() {
    let mut p = ready(); assert!(p.feature_request(request("text"), "private").is_err());
    for field in ["version", "operations", "run_modes", "lifetime", "automatic_retry"] {
        let mut cap = capability(); cap[field] = json!(null);
        p.snapshot.features.discover(&json!({"brief":cap}));
        assert!(p.feature_request(request("text"), "private").is_err());
    }
    p.snapshot.features.discover(&json!({"brief":capability()}));
    assert!(p.feature_request(request(" \n\t"), "private").is_err());
    assert!(serde_json::from_value::<brief::Request>(json!({"operation":"brief.stage","api_version":1,"body":"x","extra":0})).is_err());
}
#[test]
fn brief_exact_body_completed_receipt_and_independent_run_correlation() {
    let mut p = ready(); p.snapshot.features.discover(&json!({"brief":capability()}));
    let body = "  한글 🌍\n    indentation\t \n/run stays text  \n\n";
    let wire: Value = serde_json::from_slice(&p.feature_request(request(body), "private").unwrap()).unwrap();
    assert_eq!(wire["body"], body); assert_eq!(wire["operation"], "brief.stage");
    assert_eq!(wire["session_id"], "expected"); assert_eq!(wire["request_id"], 2);
    p.response(packet(2, "accepted", "queued")).unwrap();
    assert!(p.snapshot.features.results[0].reply.is_none()); assert!(p.snapshot.results.is_empty());
    let mut crossed = staged(2); crossed["session_id"] = json!("other"); assert!(p.response(crossed).is_err());
    p.response(staged(2)).unwrap();
    let run: Value = serde_json::from_slice(&p.request(Some("/run".into()), "private").unwrap()).unwrap();
    assert_eq!(run["request_id"], 3); assert_eq!(run["command"], "/run");
    p.response(packet(3, "accepted", "queued")).unwrap(); assert_eq!(p.snapshot.results[0].phase.as_deref(), Some("queued"));
    let mut done = packet(3, "accepted", "completed"); done["owner_status"] = json!("SUCCESS");
    p.response(done).unwrap(); assert_eq!(p.snapshot.results[0].owner_status.as_deref(), Some("SUCCESS"));
    assert_eq!(p.snapshot.results[0].phase.as_deref(), Some("completed"));
    assert_eq!(p.snapshot.features.results.len(), 1);
}
#[test]
fn brief_rejected_unknown_and_malformed_receipts_preserve_exact_request() {
    for mode in ["rejected", "unknown", "malformed", "disconnected"] {
        let mut p = ready(); p.snapshot.features.discover(&json!({"brief":capability()}));
        p.feature_request(request("retained"), "private").unwrap();
        p.response(packet(2, "accepted", "queued")).unwrap();
        let mut reply = staged(2);
        match mode {
            "rejected" => { reply["status"] = json!("rejected"); reply["staging_status"] = json!("not_staged"); }
            "unknown" => { reply["status"] = json!("failure"); reply["staging_status"] = json!("unknown"); reply["outcome_unknown"] = json!(true); }
            "malformed" => { reply["count"] = json!(0); }
            _ => { p.disconnect("EOF"); }
        }
        if mode == "malformed" { assert!(p.response(reply).is_err()); p.disconnect("Malformed Brief receipt"); }
        else if mode != "disconnected" { p.response(reply).unwrap(); }
        let result = &p.snapshot.features.results[0];
        assert_eq!(result.id, 2);
        assert_eq!(result.state, if mode == "rejected" { "rejected" } else { "outcome-unknown" });
        assert!(p.snapshot.results.is_empty());
    }
}
