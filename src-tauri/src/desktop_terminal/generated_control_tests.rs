use super::*;
use std::sync::mpsc;
use super::super::generated_images::{self, Request};
fn capability() -> Value {
    json!({"version":1,"operations":["generated_images.list","generated_images.read"],"mime_types":["image/png"],
        "max_image_bytes":16777216,"max_chunk_bytes":32768,"page_size":32,"lifetime":"owning_control_connection","read_only":true})
}
fn capable() -> Protocol {
    let mut protocol = ready(); protocol.request(None, "private").unwrap();
    let mut value = packet(2, "accepted", "completed"); value["observation"] = observation();
    value["capabilities"] = json!({"generated_images":capability()}); protocol.response(value).unwrap(); protocol
}
#[test]
fn extension_discovery_requires_authenticated_completed_observe_and_preserves_legacy() {
    let mut legacy = ready(); assert!(!legacy.snapshot.generated_images_supported);
    let (send, _) = mpsc::channel(); assert!(legacy.image_request(Request::List { offset: 0 }, send, "private").is_err());
    legacy.request(None, "private").unwrap();
    let mut queued = packet(2, "accepted", "queued"); queued["capabilities"] = json!({"generated_images":capability()});
    legacy.response(queued).unwrap(); assert!(!legacy.snapshot.generated_images_supported);
    let mut crossed = packet(2, "accepted", "completed"); crossed["session_id"] = json!("foreign");
    crossed["observation"] = observation(); crossed["capabilities"] = json!({"generated_images":capability()});
    assert!(legacy.response(crossed).is_err()); assert!(!legacy.snapshot.generated_images_supported);
    assert!(capable().snapshot.generated_images_supported);
    let mut invalid = capability(); invalid["max_chunk_bytes"] = json!(65536);
    assert!(generated_images::Capability::read(&invalid).is_none());
}
#[test]
fn image_results_are_correlated_and_never_mistaken_for_observations() {
    let mut a = capable(); let mut b = capable();
    b.session = "other".into();
    let (send, receive) = mpsc::channel();
    let wire: Value = serde_json::from_slice(&a.image_request(Request::List { offset: 0 }, send, "secret").unwrap()).unwrap();
    assert_eq!(wire["request_id"], 3); assert_eq!(wire["operation"], "generated_images.list");
    assert_eq!(wire["session_id"], "expected"); assert_eq!(wire["key"], "secret");
    let mut completed = packet(3, "accepted", "completed");
    completed["images"] = json!([]); completed["total_count"] = json!(0); completed["offset"] = json!(0); completed["next_offset"] = Value::Null;
    assert!(b.response(completed.clone()).is_err()); assert!(receive.try_recv().is_err());
    a.response(packet(3, "accepted", "queued")).unwrap(); assert!(receive.try_recv().is_err());
    a.response(completed.clone()).unwrap(); assert!(matches!(receive.recv().unwrap().unwrap(), generated_images::Reply::Page { total: 0, .. }));
    assert_eq!(a.snapshot.observation_serial, 2); assert!(a.response(completed).is_err());
    let image = serde_json::from_value(json!({"image_id":"a".repeat(32),"source_sequence":1,"output_index":0,
        "source":"codex.imageGeneration","mime_type":"image/png","byte_length":100,
        "sha256":"0".repeat(64),"width":2,"height":1})).unwrap();
    let (send, receive) = mpsc::channel();
    a.image_request(Request::Read { image, offset: 17, length: 17 }, send, "secret").unwrap();
    a.disconnect("Fixture exit during retrieval"); assert_eq!(receive.recv().unwrap().err().unwrap().state, "unavailable");
    assert!(!a.snapshot.generated_images_supported); assert!(b.snapshot.generated_images_supported);
    let public = serde_json::to_string(&a.public_snapshot()).unwrap();
    for private in ["secret", "image_id", "data_base64", "max_chunk_bytes", "connection_id"] { assert!(!public.contains(private)); }
}
