//! Installed-Runner compatibility through the existing owned PTY fixture.
use super::*;
use super::super::control::references::{ReferenceAdmission, ReferenceRequest};
#[test]
#[ignore = "Requires HUB_RUNNER_ACCEPTANCE_ROOT and a task-owned HUB_REFERENCE_FIXTURE_PATH on Windows"]
fn installed_images_and_reference_requests_share_the_authenticated_owner() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let path = std::env::var("HUB_REFERENCE_FIXTURE_PATH").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "Task-owned native reference compatibility fixture\n");
    let mut harness = Harness::new();
    let id = harness.open_runner(&root);
    let session = harness.sessions.owned(&id, "test-window").unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(40);
    while session.control_snapshot().unwrap().state != "ready" {
        assert!(std::time::Instant::now() < deadline, "Authenticated installed Runner unavailable");
        harness.pump_for(Duration::from_millis(50));
    }
    assert!(session.control_snapshot().unwrap().generated_images_supported);
    assert!(session.images_list().unwrap().is_empty());
    let ReferenceAdmission::Admitted { id: request } = session.control_reference(ReferenceRequest::Register { path }).unwrap() else {
        panic!("Native reference was not admitted");
    };
    loop {
        if let Some(result) = session.control_snapshot().unwrap().references.results.iter().find(|result| result.id == request) {
            if result.state == "registered" {
                assert_eq!(result.reference.as_ref().unwrap().display_name, "task14-native-reference.txt");
                assert_eq!(result.inventory.as_ref().unwrap().total_count, 1);
                break;
            }
            assert!(matches!(result.state.as_str(), "sending" | "queued"), "Native reference did not register: {}", result.state);
        }
        assert!(std::time::Instant::now() < deadline, "Native registration completion missing");
        harness.pump_for(Duration::from_millis(50));
    }
    assert!(session.images_list().unwrap().is_empty());
    session.close().unwrap(); harness.exited(&id);
}