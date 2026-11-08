//! Opt-in installed Runner evidence without a Provider turn or historical candidate guess.
use super::*;
use control::{features, recovery};
use std::time::Instant;

#[test]
#[ignore = "Requires HUB_RUNNER_ACCEPTANCE_ROOT and an explicitly supplied exact HUB_RECOVERY_OBSERVE_REFERENCE"]
fn installed_exact_lifecycle_observation_without_work_dispatch() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let reference: recovery::Reference = serde_json::from_str(&std::env::var("HUB_RECOVERY_OBSERVE_REFERENCE").unwrap()).unwrap();
    let mut harness = Harness::new();
    let id = harness.open_runner(&root);
    let session = harness.sessions.owned(&id, "test-window").unwrap();
    let deadline = Instant::now() + Duration::from_secs(45);
    while session.control_snapshot().unwrap().state == "connecting" {
        assert!(Instant::now() < deadline); harness.pump_for(Duration::from_millis(30));
    }
    let snapshot = session.control_snapshot().unwrap();
    assert_eq!(snapshot.state, "ready", "{snapshot:?}");
    assert_eq!(snapshot.features.recovery.as_ref().unwrap().lifecycle_version, Some(1));
    let admission = session.control_feature(features::Request::Recovery(recovery::Request::Observe {
        api_version: 1, reference: reference.clone(),
    })).unwrap();
    let features::Admission::Submitted { id: request_id, .. } = admission else { panic!("{admission:?}") };
    // The result is observed through the actual native client, never injected into WorkEvidence.
    loop {
        let current = session.control_snapshot().unwrap();
        assert_eq!(current.features.generation, snapshot.features.generation);
        if let Some(result) = current.features.results.iter().find(|r| r.id == request_id && r.phase.as_deref() == Some("completed")) {
            let Some(features::Response::Recovery(reply)) = &result.reply else { panic!("{result:?}") };
            assert_eq!(result.state, "accepted"); assert_eq!(reply.reference.as_ref(), Some(&reference));
            assert_eq!(reply.authoritative, Some(true));
            println!("Installed exact lifecycle: disposition={:?}, terminal={:?}, ownership={:?}",
                reply.disposition, reply.terminal, reply.ownership);
            break;
        }
        assert!(Instant::now() < deadline, "{current:?}"); harness.pump_for(Duration::from_millis(30));
    }
    session.close().unwrap(); harness.exited(&id);
}

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
    assert_eq!(snapshot.state, "ready", "{snapshot:?}; native Runner output: {}",
        String::from_utf8_lossy(harness.output.get(&id).map(Vec::as_slice).unwrap_or_default()));
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
    assert!(harness.sessions.sessions.lock().unwrap().is_empty(), "Owned acceptance sessions must be retired");
}
