use super::*;
fn capability() -> Value { json!({"version":1,"operations":["interaction.observe","interaction.respond"],
    "dispatch_boundary":"foreground_input","automatic_replay":false,"lifetime":"current_owner"}) }
fn observe() -> features::Request { features::Request::Interaction(interaction::Request::Observe { api_version:1 }) }
fn view() -> Value { json!({"state":"active","interaction_id":"revision-1","kind":"selection","prompt":"Choose",
    "context":"Canonical context","actions":["select","back","cancel"],"text_input":null,
    "choices":[{"choice_id":"row-1","label":"Visible","description":"Description","enabled":true,"disabled_reason":""}]}) }
fn selected() -> features::Request { features::Request::Interaction(interaction::Request::Respond {
    api_version:1, interaction_id:"revision-1".into(), action:interaction::Action::Select { choice_id:"row-1".into() } }) }
#[test]
fn interaction_envelopes_and_capabilities_fail_closed() {
    let mut p = ready(); assert!(p.feature_request(observe(), "key").is_err());
    for field in ["version","operations","dispatch_boundary","automatic_replay","lifetime"] {
        let mut cap=capability(); cap[field]=json!(null);
        assert!(interaction::Capability::read(&cap).is_none());
    }
    for fields in [json!({"operation":"interaction.observe","api_version":1,"text":"extra"}),
        json!({"operation":"interaction.respond","api_version":1,"interaction_id":"id","action":"back","text":"extra"}),
        json!({"operation":"interaction.respond","api_version":1,"interaction_id":"id","action":"confirm"})] {
        assert!(serde_json::from_value::<interaction::Request>(fields).is_err());
    }
    let valid=json!({"operation":"interaction.respond","api_version":1,"interaction_id":"id","action":"text","text":"  Unicode 世界  "});
    assert!(serde_json::from_value::<interaction::Request>(valid).unwrap().validate().is_ok());
}
#[test]
fn pending_command_does_not_serialize_foreground_input_and_keeps_final_effect_separate() {
    let mut p=ready(); p.snapshot.features.discover(&json!({"interaction":capability()}));
    p.request(Some("/target".into()),"key").unwrap();
    p.response(packet(2,"pending-interaction","awaiting_interaction")).unwrap();
    let wire:Value=serde_json::from_slice(&p.feature_request(observe(),"private").unwrap()).unwrap();
    assert_eq!(wire["key"],"private"); assert_eq!(wire["session_id"],"expected");
    let mut observed=packet(3,"accepted","completed"); observed["interaction"]=view(); p.response(observed).unwrap();
    assert_eq!(p.snapshot.results[0].state,"pending-interaction");
    p.feature_request(selected(),"private").unwrap();
    assert!(p.feature_request(selected(),"private").is_err());
    let mut receipt=packet(4,"accepted","completed"); receipt["input_status"]=json!("accepted");
    receipt["interaction_status"]=json!("completed"); receipt["effect_status"]=json!("awaiting_command_owner");
    receipt["outcome_unknown"]=json!(false); receipt["interaction"]=json!({"state":"none"}); p.response(receipt).unwrap();
    assert_eq!(p.snapshot.results[0].state,"pending-interaction");
    assert!(p.snapshot.results[0].changed.is_none());
    p.response(packet(2,"rejected","completed")).unwrap(); assert_eq!(p.snapshot.results[0].state,"rejected");
}
#[test]
fn changed_identity_choice_or_receipt_is_never_promoted() {
    let mut v=view();
    let features::Request::Interaction(r)=selected() else { unreachable!() };
    assert!(r.permitted(&v)); v["choices"][0]["enabled"]=json!(false); assert!(!r.permitted(&v));
    v=view(); v["interaction_id"]=json!("other"); assert!(!r.permitted(&v));
    v=view(); v["choices"][0]["choice_id"]=json!(""); assert!(!interaction::valid_view(&v));
    assert!(!interaction::valid_view(&json!({"state":"unsupported","prompt":"invented"})));
    let mut receipt=packet(1,"accepted","completed"); receipt["input_status"]=json!("accepted");
    assert!(r.response(&receipt).is_err());
    let mut p=ready();p.snapshot.features.discover(&json!({"interaction":capability()})); p.feature_request(observe(),"key").unwrap();
    receipt=packet(2,"accepted","completed");receipt["interaction"]=view();receipt["session_id"]=json!("other");
    assert!(p.response(receipt).is_err());
}

#[test]
fn response_transport_loss_preserves_unknown_and_blocks_native_replay() {
    let mut p=ready(); p.snapshot.features.discover(&json!({"interaction":capability()}));
    p.feature_request(observe(),"key").unwrap();
    let mut observed=packet(2,"accepted","completed");observed["interaction"]=view();p.response(observed).unwrap();
    p.feature_request(selected(),"key").unwrap();
    p.response(packet(3,"accepted","queued")).unwrap();
    p.disconnect("Fixture EOF after admission");
    assert_eq!(p.snapshot.features.results.last().unwrap().state,"outcome-unknown");
    assert!(p.feature_request(selected(),"key").is_err());
    assert!(!interaction::valid_view(&json!({"state":"unsupported","code":{}})));
    for text in ["line\nnext", "line\rnext", "line\0next"] {
        assert!(interaction::Request::Respond { api_version:1, interaction_id:"revision-1".into(),
            action:interaction::Action::Text { text:text.into() } }.validate().is_err());
    }
}

#[test]
fn foreground_observation_does_not_retire_another_features_unconsumed_receipt() {
    let mut p=ready(); p.snapshot.features.discover(&json!({"interaction":capability()}));
    p.snapshot.features.results.push(features::ResultView { id:99, feature:"session_config".into(),
        operation:"session_config.inspect".into(), state:"accepted".into(), admission:"queued".into(),
        phase:Some("completed".into()), code:None, reply:None });
    p.feature_request(observe(),"key").unwrap();
    assert!(p.snapshot.features.results.iter().any(|result| result.id==99));
}
