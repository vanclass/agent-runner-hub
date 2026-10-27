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
