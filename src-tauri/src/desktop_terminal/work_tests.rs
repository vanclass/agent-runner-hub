use super::*;

fn cap() -> Value {
    json!({"version":1,"operations":["work.submit","work.status"],"run_modes":work::RUN_MODES,
        "observation_lifetime":"process_session","automatic_retry":false})
}
fn configured() -> Protocol {
    let mut p = ready();
    p.snapshot.features.discover(&json!({"work":cap()}));
    p
}
fn submit() -> features::Request {
    features::Request::Work(work::Request::Submit { api_version:1, instruction:"exact instruction\n한글".into() })
}
fn status(original: u64) -> features::Request {
    features::Request::Work(work::Request::Status { api_version:1, submission_request_id:original })
}
fn evidence(original: u64, state: &str, event: u64, started: u64) -> Value {
    json!({"submission_request_id":original,"run_mode":"task-run","state":state,"admission":if started>0 {"admitted"} else {"pending"},
        "work_id":if started>0 {json!({"kind":"task","id":"opaque-work"})} else {Value::Null},
        "execution_id":"","event_id":event,"started_event_id":started,"terminal":false,"outcome":"pending",
        "code":"","owner":"input_consumer","owner_revision":0})
}
#[test]
fn capability_and_request_validation_preserve_v1_and_terminal_commands() {
    let mut p = ready(); assert!(p.feature_request(submit(), "key").is_err());
    for field in ["version","operations","run_modes","observation_lifetime","automatic_retry"] {
        let mut bad=cap(); bad[field]=json!(99);
        p.snapshot.features.discover(&json!({"work":bad}));
        assert!(p.feature_request(submit(), "key").is_err());
    }
    for value in [json!({"operation":"work.submit","api_version":true,"instruction":"x"}),
        json!({"operation":"work.submit","api_version":1,"instruction":"\0"}),
        json!({"operation":"work.submit","api_version":1,"instruction":"/status"}),
        json!({"operation":"work.status","api_version":1,"submission_request_id":0}),
        json!({"operation":"work.status","api_version":1,"submission_request_id":2,"extra":true})] {
        let parsed=serde_json::from_value::<work::Request>(value);
        assert!(parsed.is_err() || parsed.unwrap().validate().is_err());
    }
    assert!(p.request(Some("/status".into()),"key").is_ok());
}
#[test]
fn work_uses_original_identity_sequence_and_retains_submission_separately_from_start() {
    let mut p=configured();
    let wire:Value=serde_json::from_slice(&p.feature_request(submit(),"private").unwrap()).unwrap();
    assert_eq!(wire["process_id"],42); assert_eq!(wire["session_id"],"expected");
    assert_eq!(wire["request_id"],2); assert_eq!(wire["instruction"],"exact instruction\n한글");
    p.response(packet(2,"accepted","queued")).unwrap();
    assert_eq!(p.snapshot.features.results[0].state,"queued");
    assert!(p.snapshot.features.results[0].reply.is_none());
    let mut receipt=packet(2,"accepted","completed");
    receipt["receipt"]=json!("dispatch_received"); receipt["work"]=evidence(2,"dispatching",1,0);
    p.response(receipt).unwrap();
    let status_wire:Value=serde_json::from_slice(&p.feature_request(status(2),"private").unwrap()).unwrap();
    assert_eq!(status_wire["request_id"],3); assert_eq!(status_wire["submission_request_id"],2);
    let mut reply=packet(3,"accepted","completed"); reply["work"]=evidence(2,"active",4,3);
    p.response(reply).unwrap();
    assert_eq!(p.snapshot.features.results.len(),2);
    assert_eq!(p.snapshot.observation_serial,1);
    match p.snapshot.features.results[1].reply.as_ref().unwrap() {
        features::Response::Work(r) => {let w=r.work.as_ref().unwrap(); assert_eq!(w.started_event_id,3); assert!(!w.terminal);},
        _ => panic!("wrong feature"),
    }
    let public=serde_json::to_string(&p.public_snapshot()).unwrap();
    assert!(!public.contains("exact instruction")); assert!(!public.contains("private"));
    assert!(!public.contains("connection_id")); assert!(!public.contains("session_id"));
}
#[test]
fn every_status_completion_must_correlate_the_original_submission() {
    for field in ["submission_request_id","event_id","started_event_id","run_mode","state"] {
        let mut p=configured(); p.feature_request(status(2),"key").unwrap();
        let mut reply=packet(2,"accepted","completed"); reply["work"]=evidence(2,"active",4,3);
        reply["work"][field]=json!(if field == "event_id" { 0 } else { 999 });
        assert!(p.response(reply).is_err(),"{field}");
    }
    let mut p=configured(); p.feature_request(status(2),"key").unwrap();
    let mut absent=packet(2,"rejected","completed");
    absent["code"]=json!("SUBMISSION_NOT_OBSERVED"); absent["outcome_unknown"]=json!(true);
    p.response(absent).unwrap();
    assert_eq!(p.snapshot.features.results[0].state,"outcome-unknown");
}
#[test]
fn unfinished_and_terminal_states_survive_without_inferred_task_completion() {
    for (state,terminal,outcome) in [("suspended",false,"interrupted"),("incomplete",false,"incomplete"),
        ("failed",false,"failed"),("unknown",false,"unknown"),("succeeded",true,"succeeded"),
        ("incomplete",true,"incomplete"),("interrupted",true,"interrupted")] {
        let mut p=configured(); p.feature_request(status(2),"key").unwrap();
        let mut reply=packet(2,"accepted","completed"); reply["work"]=evidence(2,state,6,3);
        reply["work"]["terminal"]=json!(terminal); reply["work"]["outcome"]=json!(outcome);
        p.response(reply).unwrap();
        match p.snapshot.features.results[0].reply.as_ref().unwrap() {
            features::Response::Work(r) => {let w=r.work.as_ref().unwrap(); assert_eq!(w.terminal,terminal); assert_eq!(w.outcome,outcome);},
            _ => panic!("wrong feature"),
        }
    }
}
#[test]
fn submission_exit_distinguishes_provably_unsent_from_ambiguous_without_replay() {
    for (bytes,expected) in [(0,"not-sent"),(1,"outcome-unknown")] {
        let mut p=configured(); p.feature_request(submit(),"key").unwrap();
        p.written_bytes=p.pending[&2].wire_start+bytes;
        p.disconnect("EOF");
        assert_eq!(p.snapshot.features.results[0].state,expected); assert!(p.pending.is_empty());
        assert!(p.feature_request(submit(),"key").is_err());
    }
}
fn discovery_cap() -> Value {
    let mut value = cap();
    value["operations"] = json!(["work.submit", "work.status", "work.list", "work.observe"]);
    value["origins"] = json!(["api", "terminal"]); value["max_page_size"] = json!(100);
    value
}
fn terminal_evidence(event: u64) -> Value {
    let mut value = evidence(1, "succeeded", event, 1);
    value["observation_id"] = json!("terminal:1"); value["origin"] = json!("terminal");
    value["submission_request_id"] = Value::Null;
    value["terminal"] = json!(true); value["outcome"] = json!("succeeded");
    value
}
fn list(after: u64, limit: u32) -> features::Request {
    features::Request::Work(work::Request::List { api_version: 1, after_event_id: after, limit })
}
#[test]
fn discovery_is_additive_and_requires_verified_origins_and_page_bound() {
    let mut p = configured(); assert!(p.feature_request(list(0, 100), "key").is_err());
    for (field, bad) in [("origins", json!(["api"])), ("origins", json!(["api", "api"])), ("max_page_size", json!(101))] {
        let mut cap = discovery_cap(); cap[field] = bad;
        p.snapshot.features.discover(&json!({"work": cap}));
        assert!(p.feature_request(list(0, 100), "key").is_err());
        assert!(p.snapshot.features.supports(&status(2)));
    }
}
#[test]
fn discovery_requests_reject_unbounded_or_ambiguous_identity_fields() {
    for value in [json!({"operation":"work.list","api_version":1,"after_event_id":0,"limit":0}),
        json!({"operation":"work.list","api_version":1,"after_event_id":0,"limit":101}),
        json!({"operation":"work.list","api_version":1,"after_event_id":-1,"limit":2}),
        json!({"operation":"work.list","api_version":true,"after_event_id":0,"limit":2}),
        json!({"operation":"work.list","api_version":1,"after_event_id":0,"limit":2,"instruction":"x"}),
        json!({"operation":"work.observe","api_version":1,"observation_id":"terminal:01"}),
        json!({"operation":"work.observe","api_version":1,"observation_id":"api:0"}),
        json!({"operation":"work.observe","api_version":1,"observation_id":"terminal:1","submission_request_id":1})] {
        let request = serde_json::from_value::<work::Request>(value);
        assert!(request.is_err() || request.unwrap().validate().is_err());
    }
}
#[test]
fn terminal_null_identity_survives_list_and_individual_observe() {
    let mut p = configured(); p.snapshot.features.discover(&json!({"work":discovery_cap()}));
    let wire: Value = serde_json::from_slice(&p.feature_request(list(0, 1), "private").unwrap()).unwrap();
    assert_eq!(wire["operation"], "work.list"); assert_eq!(wire["after_event_id"], 0);
    assert!(wire.get("instruction").is_none());
    let mut reply = packet(2, "accepted", "completed");
    reply["works"] = json!([terminal_evidence(2)]); reply["has_more"] = json!(true);
    reply["next_after_event_id"] = json!(2); reply["latest_event_id"] = json!(4);
    p.response(reply).unwrap();
    assert!(serde_json::to_value(&p.public_snapshot()).unwrap()["features"]["results"][0]["reply"]["works"][0]["submission_request_id"].is_null());
    let request = features::Request::Work(work::Request::Observe { api_version: 1, observation_id: "terminal:1".into() });
    let wire: Value = serde_json::from_slice(&p.feature_request(request, "private").unwrap()).unwrap();
    assert_eq!(wire["request_id"], 3); assert_eq!(wire["observation_id"], "terminal:1");
    let mut reply = packet(3, "accepted", "completed"); reply["work"] = terminal_evidence(4);
    p.response(reply).unwrap();
    let public = serde_json::to_value(p.public_snapshot()).unwrap();
    assert_eq!(public["features"]["results"][0]["reply"]["work"]["observation_id"], "terminal:1");
    assert_eq!(public["features"]["results"][0]["reply"]["work"]["started_event_id"], 1);
}
#[test]
fn discovery_rejects_incomplete_pages_and_invalid_cursor_evidence() {
    for (field, bad) in [("has_more", Value::Null), ("has_more", json!(true)),
        ("next_after_event_id", json!(1)), ("latest_event_id", json!(1)),
        ("works", json!([terminal_evidence(2), terminal_evidence(2)]))] {
        let mut p = configured(); p.snapshot.features.discover(&json!({"work":discovery_cap()}));
        p.feature_request(list(0, 2), "key").unwrap();
        let mut reply = packet(2, "accepted", "completed");
        reply["works"] = json!([terminal_evidence(2)]); reply["has_more"] = json!(false);
        reply["next_after_event_id"] = json!(2); reply["latest_event_id"] = json!(2);
        reply[field] = bad; assert!(p.response(reply).is_err(), "{field}");
    }
}
#[test]
fn observations_reject_crossed_identity_and_missing_nullable_submission() {
    for (field, bad) in [("observation_id", json!("terminal:2")), ("origin", json!("api")),
        ("submission_request_id", json!(1)), ("terminal", json!("true")), ("event_id", json!(true))] {
        let mut work = terminal_evidence(2); work[field] = bad;
        let request = work::Request::Observe { api_version: 1, observation_id: "terminal:1".into() };
        let mut reply = packet(2, "accepted", "completed"); reply["work"] = work;
        assert!(request.response(&reply, 2).is_err(), "{field}");
    }
    let mut work = terminal_evidence(2); work.as_object_mut().unwrap().remove("submission_request_id");
    let request = work::Request::Observe { api_version: 1, observation_id: "terminal:1".into() };
    let mut reply = packet(2, "accepted", "completed"); reply["work"] = work;
    assert!(request.response(&reply, 2).is_err());
    let mut p = configured(); p.snapshot.features.discover(&json!({"work":discovery_cap()}));
    p.feature_request(list(0, 100), "key").unwrap();
    let mut foreign = packet(2, "accepted", "completed"); foreign["session_id"] = json!("neighbor");
    assert!(p.response(foreign).is_err());
}
