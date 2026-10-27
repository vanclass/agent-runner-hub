//! Public Runner transport evidence. No Provider execution is required or claimed.
use super::*;
use control::{features, work};
use std::time::Instant;

fn call(harness: &mut Harness, session: &Arc<Session>, request: work::Request) -> features::ResultView {
    let admission = session.control_feature(features::Request::Work(request)).unwrap();
    let id = match admission { features::Admission::Submitted { id, .. } => id, other => panic!("{other:?}") };
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        let snapshot = session.control_snapshot().unwrap();
        if let Some(result) = snapshot.features.results.iter().find(|r| r.id == id
            && matches!(r.state.as_str(), "accepted" | "rejected" | "failure" | "outcome-unknown" | "not-sent")) {
            return result.clone();
        }
        assert!(snapshot.state == "ready" && Instant::now() < deadline, "{snapshot:?}");
        harness.pump_for(Duration::from_millis(20));
    }
}
fn observed(result: &features::ResultView) -> &work::Response {
    match result.reply.as_ref().unwrap() { features::Response::Work(r) => r, other => panic!("{other:?}") }
}
#[test]
#[ignore = "Requires explicitly selected isolated public Runner at HUB_RUNNER_ACCEPTANCE_ROOT"]
fn public_work_identity_receipts_status_and_exact_owned_shutdown() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    assert!(std::path::Path::new(&root).join("hub-acceptance-fixture.json").is_file(), "isolated fixture required");
    let mut harness = Harness::new();
    let first_id = harness.open_runner(&root); let second_id = harness.open_runner(&root);
    let first = harness.sessions.owned(&first_id, "test-window").unwrap();
    let second = harness.sessions.owned(&second_id, "test-window").unwrap();
    let deadline = Instant::now() + Duration::from_secs(45);
    while [first.control_snapshot().unwrap(), second.control_snapshot().unwrap()].iter().any(|s| s.state == "connecting") {
        assert!(Instant::now() < deadline, "public Runner authentication deadline");
        harness.pump_for(Duration::from_millis(30));
    }
    let a = first.control_snapshot().unwrap(); let b = second.control_snapshot().unwrap();
    assert_eq!(a.state, "ready", "{a:?}; {}", String::from_utf8_lossy(harness.output.get(&first_id).map(Vec::as_slice).unwrap_or_default()));
    assert_eq!(b.state, "ready", "{b:?}");
    assert_ne!(a.features.generation, b.features.generation);
    assert_eq!(a.features.work.unwrap().version, 1); assert_eq!(b.features.work.unwrap().version, 1);
    // A clean unauthenticated fixture may reject at setup/foreground admission.
    // Such a result proves transport and Runner evidence, never genuine Agent start.
    let submit = call(&mut harness, &first, work::Request::Submit { api_version:1,
        instruction:"Reply READY without modifying files. This is one isolated transport acceptance instruction.".into() });
    let original = submit.id;
    assert_eq!(submit.phase.as_deref(), Some("completed"));
    let receipt = observed(&submit);
    assert!(receipt.work.is_some(), "{submit:?}");
    if submit.state == "accepted" { assert_eq!(receipt.receipt.as_deref(), Some("dispatch_received")); }
    let status = call(&mut harness, &first, work::Request::Status { api_version:1, submission_request_id:original });
    let work = observed(&status).work.as_ref().unwrap();
    assert_eq!(work.submission_request_id, original);
    let foreign = call(&mut harness, &second, work::Request::Status { api_version:1, submission_request_id:original });
    assert_eq!(foreign.state, "outcome-unknown");
    assert_eq!(observed(&foreign).code.as_deref(), Some("SUBMISSION_NOT_OBSERVED"));
    assert_eq!(first.control_snapshot().unwrap().features.results.iter().filter(|r| r.operation == "work.submit").count(), 1);
    first.close().unwrap(); harness.exited(&first_id);
    assert_eq!(first.control_snapshot().unwrap().state, "disconnected");
    assert_eq!(second.control_snapshot().unwrap().state, "ready");
    second.close().unwrap(); harness.exited(&second_id);
    assert!(harness.sessions.sessions.lock().unwrap().is_empty());
    println!("PUBLIC_WORK_TRANSPORT original={original}, state={}, admission={}, event={}, started={}, terminal={}, outcome={}; two independent instances, one submit, foreign lookup unknown, owned shutdown verified. Provider execution not claimed.",
        work.state, work.admission, work.event_id, work.started_event_id, work.terminal, work.outcome);
}
