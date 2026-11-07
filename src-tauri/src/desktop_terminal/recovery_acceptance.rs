//! Opt-in installed Runner evidence without a Provider turn or historical candidate guess.
use super::*;
use control::{features, recovery};
use std::time::Instant;

#[test]
#[ignore = "Requires HUB_RUNNER_ACCEPTANCE_ROOT; no instructions or continuation are submitted"]
fn installed_exact_recovery_reference_is_unverified_without_confirmed_work() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let mut harness = Harness::new();
    let id = harness.open_runner(&root);
    let session = harness.sessions.owned(&id, "test-window").unwrap();
    let deadline = Instant::now() + Duration::from_secs(45);
    while session.control_snapshot().unwrap().state == "connecting" {
        assert!(Instant::now() < deadline);
        harness.pump_for(Duration::from_millis(30));
    }
    let snapshot = session.control_snapshot().unwrap();
    assert_eq!(snapshot.state, "ready", "{snapshot:?}");
    assert!(snapshot.features.recovery.is_some(), "Installed Runner recovery capability unavailable");
    let admission = session.control_feature(features::Request::Recovery(recovery::Request::Reference {
        api_version: 1, observation_id: "terminal:1".into(),
    })).unwrap();
    let features::Admission::Submitted { id: request_id, .. } = admission else { panic!("{admission:?}") };
    loop {
        let snapshot = session.control_snapshot().unwrap();
        if let Some(result) = snapshot.features.results.iter().find(|r| r.id == request_id && r.phase.as_deref() == Some("completed")) {
            let Some(features::Response::Recovery(reply)) = &result.reply else { panic!("{result:?}") };
            assert_eq!(reply.recovery_status.as_deref(), Some("unverified"));
            assert!(reply.reference.is_none()); break;
        }
        assert!(Instant::now() < deadline, "{snapshot:?}");
        harness.pump_for(Duration::from_millis(30));
    }
    assert!(!harness.output.get(&id).unwrap().is_empty(), "Native Runner logs were not delivered");
    session.close().unwrap(); harness.exited(&id);
    assert_eq!(session.control_snapshot().unwrap().state, "disconnected");
    let next = harness.open_runner(&root);
    let replacement = harness.sessions.owned(&next, "test-window").unwrap();
    while replacement.control_snapshot().unwrap().state == "connecting" {
        assert!(Instant::now() < deadline);
        harness.pump_for(Duration::from_millis(30));
    }
    let fresh = replacement.control_snapshot().unwrap();
    assert_eq!(fresh.state, "ready", "{fresh:?}");
    assert_ne!(fresh.features.generation, snapshot.features.generation);
    replacement.close().unwrap(); harness.exited(&next);
}
