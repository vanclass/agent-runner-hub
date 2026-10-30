//! Explicit Test Runner acceptance through the existing native installation and work protocol.
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
#[ignore = "Requires explicitly selected installed Runner and configured authenticated Test account"]
fn public_work_identity_receipts_status_and_exact_owned_shutdown() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
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
    // This explicitly designated acceptance session consumes Runner's saved test account.
    let other = second.control_snapshot().unwrap().observation.unwrap().selection.account;
    super::session_config_acceptance::configure_test_session(&mut harness, &first);
    assert_eq!(second.control_snapshot().unwrap().observation.unwrap().selection.account, other);
    assert!(first.images_list().unwrap().images.is_empty(), "New owned acceptance session required");
    // Missing test-account evidence stops before this single submission; there is no startup-account fallback.
    let instruction = std::env::var("HUB_TEST_RUNNER_INSTRUCTION").unwrap_or_else(|_|
        "Reply READY without modifying files. This is one isolated transport acceptance instruction.".into());
    let submit = call(&mut harness, &first, work::Request::Submit { api_version:1,
        instruction });
    let original = submit.id;
    assert_eq!(submit.phase.as_deref(), Some("completed"));
    let receipt = observed(&submit);
    assert!(receipt.work.is_some(), "{submit:?}");
    if submit.state == "accepted" { assert_eq!(receipt.receipt.as_deref(), Some("dispatch_received")); }
    let status = call(&mut harness, &first, work::Request::Status { api_version:1, submission_request_id:original });
    let work = observed(&status).work.as_ref().unwrap();
    assert_eq!(work.submission_request_id, Some(original));
    let foreign = call(&mut harness, &second, work::Request::Status { api_version:1, submission_request_id:original });
    assert_eq!(foreign.state, "outcome-unknown");
    assert_eq!(observed(&foreign).code.as_deref(), Some("SUBMISSION_NOT_OBSERVED"));
    assert_eq!(first.control_snapshot().unwrap().features.results.iter().filter(|r| r.operation == "work.submit").count(), 1);
    if std::env::var_os("HUB_TEST_RUNNER_INSTRUCTION").is_some() {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            let status = call(&mut harness, &first, work::Request::Status { api_version:1, submission_request_id:original });
            let observation = observed(&status).work.as_ref().expect("Missing original work evidence");
            assert_eq!(status.state, "accepted", "{status:?}");
            assert_ne!(observation.outcome, "unknown");
            if observation.terminal {
                assert_eq!(observation.outcome, "succeeded", "{status:?}"); break;
            }
            assert!(Instant::now() < deadline, "Original submission remains unresolved; never replay");
            harness.pump_for(Duration::from_millis(500));
        }
        let inventory = first.images_list().expect("Native generated-image inventory unavailable");
        assert!(inventory.incomplete.is_none() && !inventory.images.is_empty(), "No genuine native image delivered");
        let image = first.image_read(&inventory.images[0].image_id).expect("Native image verification failed");
        let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("test-runner-frog.png");
        std::fs::write(&output, &image.png).unwrap();
        println!("GENUINE_NATIVE_IMAGE submission={original}, image={:?}, output={}", image.image, output.display());
    }
    first.close().unwrap(); harness.exited(&first_id);
    assert_eq!(first.control_snapshot().unwrap().state, "disconnected");
    assert_eq!(second.control_snapshot().unwrap().state, "ready");
    second.close().unwrap(); harness.exited(&second_id);
    assert!(harness.sessions.sessions.lock().unwrap().is_empty());
    println!("PUBLIC_WORK_TRANSPORT original={original}, state={}, admission={}, event={}, started={}, terminal={}, outcome={}; two independent instances, one submit, foreign lookup unknown, owned shutdown verified. Transport receipts are separate from model/image evidence.",
        work.state, work.admission, work.event_id, work.started_event_id, work.terminal, work.outcome);
}
