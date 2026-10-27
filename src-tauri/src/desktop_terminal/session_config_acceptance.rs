//! Real public Runner acceptance. No provider/catalog evidence is synthesized here.
use super::*;
use control::{features, session_config as config};
use std::time::Instant;

fn call(harness: &mut Harness, session: &Arc<Session>, request: config::Request) -> features::ResultView {
    let admission = session.control_feature(features::Request::SessionConfig(request)).unwrap();
    let id = match admission { features::Admission::Submitted { id, .. } => id,
        other => panic!("Request not submitted: {other:?}") };
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let snapshot = session.control_snapshot().unwrap();
        if let Some(result) = snapshot.features.results.iter().find(|r| r.id == id && r.phase.as_deref() == Some("completed")) {
            return result.clone();
        }
        assert!(snapshot.state == "ready" && Instant::now() < deadline, "Missing native receipt: {snapshot:?}");
        harness.pump_for(Duration::from_millis(20));
    }
}
fn inspect(harness: &mut Harness, session: &Arc<Session>) -> config::Inspection {
    let result = call(harness, session, config::Request::Inspect { api_version:1, account:None, offset:0, options_revision:None });
    match result.reply.unwrap() { features::Response::SessionConfig(config::Response::Inspect(value)) => value, value => panic!("inspect: {value:?}") }
}
fn plan(harness: &mut Harness, session: &Arc<Session>, desired: config::Desired) -> config::Plan {
    let result = call(harness, session, config::Request::Plan { api_version:1, desired });
    match result.reply.unwrap() { features::Response::SessionConfig(config::Response::Plan(value)) => { assert_eq!(value.plan_status, "ready", "{value:?}"); value },
        value => panic!("plan: {value:?}") }
}
fn apply_request(plan: &config::Plan) -> config::Request {
    config::Request::Apply { api_version:1, desired:plan.desired.clone(), revision:plan.revision.clone(), plan_id:plan.plan_id.clone().unwrap() }
}

#[test]
#[ignore = "Read-only capability discovery at explicitly selected HUB_RUNNER_ACCEPTANCE_ROOT"]
fn installed_session_config_read_only_discovery() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let mut harness = Harness::new();
    let id = harness.open_runner(&root);
    let session = harness.sessions.owned(&id, "test-window").unwrap();
    let deadline = Instant::now() + Duration::from_secs(45);
    while session.control_snapshot().unwrap().state == "connecting" {
        assert!(Instant::now() < deadline, "Installed Runner authentication deadline");
        harness.pump_for(Duration::from_millis(50));
    }
    let snapshot = session.control_snapshot().unwrap();
    assert_eq!(snapshot.state, "ready", "{snapshot:?}");
    let capability = snapshot.features.session_config.unwrap();
    assert_eq!(capability.version, 1); assert!(capability.options_revision);
    let actual = inspect(&mut harness, &session);
    assert!(config::digest(&actual.revision));
    session.close().unwrap(); harness.exited(&id);
    assert!(harness.sessions.sessions.lock().unwrap().is_empty());
    println!("Installed Runner authenticated session_config v1/options_revision and read-only inspect verified; owned session closed.");
}

#[test]
#[ignore = "Requires an isolated public Runner installation at HUB_RUNNER_ACCEPTANCE_ROOT"]
fn installed_session_config_two_sessions_and_authoritative_receipts() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").expect("dedicated fixture installation root");
    let mut harness = Harness::new();
    let first_id = harness.open_runner(&root); let second_id = harness.open_runner(&root);
    let first = harness.sessions.owned(&first_id, "test-window").unwrap();
    let second = harness.sessions.owned(&second_id, "test-window").unwrap();
    let deadline = Instant::now() + Duration::from_secs(45);
    while [first.control_snapshot().unwrap(), second.control_snapshot().unwrap()].iter().any(|s| s.state == "connecting") {
        assert!(Instant::now() < deadline, "native authentication deadline");
        harness.pump_for(Duration::from_millis(50));
    }
    let connected = first.control_snapshot().unwrap(); assert_eq!(connected.state, "ready", "{connected:?}");
    let capability = connected.features.session_config.unwrap();
    assert_eq!(capability.version, 1); assert!(capability.options_revision);
    for operation in ["session_config.inspect", "session_config.plan", "session_config.apply"] {
        assert!(capability.operations.iter().any(|s| s == operation));
    }
    assert_ne!(connected.features.generation, second.control_snapshot().unwrap().features.generation);
    let original = inspect(&mut harness, &first); let other = inspect(&mut harness, &second);
    assert!(config::digest(original.options_revision.as_deref().unwrap()));
    let desired = config::Desired { target:Some("workspace".into()), run_mode:Some("issue-run".into()), ..Default::default() };
    let planned = plan(&mut harness, &first, desired);
    let foreign = call(&mut harness, &second, apply_request(&planned));
    assert_eq!(foreign.code.as_deref(), Some("CONFIG_PLAN_MISMATCH"));
    let result = call(&mut harness, &first, apply_request(&planned));
    assert_eq!(result.state, "accepted");
    match result.reply.as_ref().unwrap() {
        features::Response::SessionConfig(config::Response::Apply(receipt)) => {
            assert_eq!(receipt.apply_status, "applied");
            assert!(!receipt.results.is_empty());
            assert!(receipt.results.iter().all(|r| matches!(r.outcome, config::Outcome::Success) && r.committed.is_some()));
        }, other => panic!("missing authoritative apply result: {other:?}"),
    }
    let after = inspect(&mut harness, &first); assert_eq!(after.current.run_mode, "issue-run"); assert_eq!(after.current.target, "workspace");
    let unchanged = inspect(&mut harness, &second);
    assert_eq!(other.revision, unchanged.revision); assert_eq!(other.current.run_mode, unchanged.current.run_mode);
    let stale = call(&mut harness, &first, apply_request(&planned));
    assert_eq!(stale.code.as_deref(), Some("CONFIG_REVISION_STALE"));
    let stale_options = call(&mut harness, &first, config::Request::Inspect { api_version:1, account:None, offset:0,
        options_revision:original.options_revision.clone() });
    assert_eq!(stale_options.code.as_deref(), Some("CONFIG_OPTIONS_REVISION_STALE"));
    for (mode, direct_root) in [("direct-run", Some(root.clone())), ("task-run", None)] {
        let planned = plan(&mut harness, &first, config::Desired { run_mode:Some(mode.into()), root:direct_root, ..Default::default() });
        assert_eq!(call(&mut harness, &first, apply_request(&planned)).state, "accepted");
        assert_eq!(inspect(&mut harness, &first).current.run_mode, mode);
    }
    first.control_command("/status".into()).unwrap(); harness.pump_for(Duration::from_secs(2));
    assert_eq!(first.control_snapshot().unwrap().results.last().unwrap().state, "accepted");
    assert!(first.control_snapshot().unwrap().references.capability.is_some());
    assert!(first.images_list().unwrap().is_empty());
    first.resize(90, 30).unwrap(); second.resize(95, 30).unwrap();
    first.close().unwrap(); harness.exited(&first_id);
    assert_eq!(first.control_snapshot().unwrap().state, "disconnected");
    assert_eq!(second.control_snapshot().unwrap().state, "ready");
    second.close().unwrap(); harness.exited(&second_id);
    assert!(harness.sessions.sessions.lock().unwrap().is_empty());
    println!("Hub native Client: two public Runner identities, capability/options guard, exact plan/apply receipts, final inspect, stale/foreign rejection, v1/images/PTY and owned cleanup passed. Provider model catalogs were not exercised.");
}
