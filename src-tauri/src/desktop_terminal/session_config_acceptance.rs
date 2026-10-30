//! Real public Runner acceptance. No provider/catalog evidence is synthesized here.
use super::*;
use control::{features, session_config as config};
use std::time::Instant;

fn call(harness: &mut Harness, session: &Arc<Session>, request: config::Request) -> features::ResultView {
    let generation = session.control_snapshot().unwrap().features.generation;
    let admission = session.control_feature(features::Request::SessionConfig(request)).unwrap();
    let id = match admission { features::Admission::Submitted { id, .. } => id,
        other => panic!("Request not submitted: {other:?}") };
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let snapshot = session.control_snapshot().unwrap();
        assert_eq!(snapshot.features.generation, generation, "Stale native configuration session");
        if let Some(result) = snapshot.features.results.iter().find(|r| r.id == id && r.phase.as_deref() == Some("completed")) {
            return result.clone();
        }
        assert!(snapshot.state == "ready" && Instant::now() < deadline, "Missing native receipt: {snapshot:?}");
        harness.pump_for(Duration::from_millis(20));
    }
}
fn inspect(harness: &mut Harness, session: &Arc<Session>) -> config::Inspection {
    let result = call(harness, session, config::Request::Inspect { api_version:1, account:None, offset:Some(0), options_revision:None, execution_context:None });
    match result.reply.unwrap() { features::Response::SessionConfig(config::Response::Inspect(value)) => value, value => panic!("inspect: {value:?}") }
}
fn plan(harness: &mut Harness, session: &Arc<Session>, desired: config::Desired) -> config::Plan {
    let result = call(harness, session, config::Request::Plan { api_version:1, desired:desired.clone() });
    assert_eq!(result.state, "accepted", "{result:?}");
    match result.reply.unwrap() { features::Response::SessionConfig(config::Response::Plan(value)) => {
        assert_eq!(value.plan_status, "ready", "{value:?}"); assert_eq!(value.api_version, 1);
        assert_eq!(value.desired, desired); assert!(!value.atomic);
        assert!(value.errors.is_empty() && value.required_confirmations.is_empty());
        assert!(config::digest(&value.revision) && value.plan_id.as_deref().is_some_and(config::digest)); value },
        value => panic!("plan: {value:?}") }
}
fn apply_request(plan: &config::Plan) -> config::Request {
    config::Request::Apply { api_version:1, desired:plan.desired.clone(), revision:plan.revision.clone(), plan_id:plan.plan_id.clone().unwrap() }
}
pub(super) fn test_selection(harness: &mut Harness, session: &Arc<Session>) -> config::TestSelection {
    let result = call(harness, session, config::Request::Inspect { api_version:1, account:None,
        offset:None, options_revision:None, execution_context:Some("test".into()) });
    assert_eq!(result.state, "accepted", "{result:?}. Configure /account → Test account settings.");
    match result.reply.unwrap() {
        features::Response::SessionConfig(config::Response::TestSelection(value)) => value,
        other => panic!("Unverified test selection: {other:?}. Configure /account → Test account settings."),
    }
}
pub(super) fn configure_test_session(harness: &mut Harness, session: &Arc<Session>) -> config::TestSelection {
    let selection = test_selection(harness, session);
    let before = inspect(harness, session);
    let mut models = Vec::new(); let mut offset = Some(0); let mut guard = None;
    while let Some(next) = offset {
        let result = call(harness, session, config::Request::Inspect { api_version:1, account:Some(selection.account.clone()),
            offset:Some(next), options_revision:guard.clone(), execution_context:None });
        let Some(features::Response::SessionConfig(config::Response::Inspect(page))) = result.reply else { panic!("Missing test model catalog") };
        assert_eq!(result.state, "accepted"); assert_eq!(page.model_catalog_status, "available");
        assert_eq!(page.model_options_account, selection.account); assert_eq!(page.revision, before.revision);
        assert_eq!(page.options_page.offset, next);
        if let Some(expected) = &guard { assert_eq!(page.options_revision.as_ref(), Some(expected)); }
        guard = page.options_revision; models.extend(page.options.models);
        offset = page.options_page.next_offset;
        assert!(offset.is_none_or(|n| n > next) && (offset.is_none() || guard.is_some()));
    }
    let model = models.iter().find(|m| m.id == before.current.model.id).or_else(|| models.first()).expect("No test-account model");
    let effort = model.reasoning_efforts.iter().find(|e| **e == before.current.model.reasoning_effort)
        .or_else(|| model.reasoning_efforts.first()).expect("No reasoning effort");
    let tier = model.service_tiers.iter().find(|t| t.as_str() == "default").expect("No default service tier");
    let desired = config::Desired { account:Some(selection.account.clone()),
        model:Some(config::Model { id:model.id.clone(), reasoning_effort:effort.clone() }), service_tier:Some(tier.clone()),
        run_mode:Some("direct-run".into()), root:Some(selection.runner_root.clone()), target:Some("workspace".into()) };
    let planned = plan(harness, session, desired);
    let result = call(harness, session, apply_request(&planned));
    assert_eq!(result.state, "accepted", "{result:?}");
    let Some(features::Response::SessionConfig(config::Response::Apply(receipt))) = result.reply else { panic!("No setting receipts") };
    assert_eq!(receipt.apply_status, "applied"); assert!(!receipt.outcome_unknown);
    assert!(!receipt.inspection_unavailable.unwrap_or(false)); assert_eq!(receipt.results.len(), planned.steps.len());
    for (step, receipt) in planned.steps.iter().zip(&receipt.results) {
        assert_eq!(&receipt.setting, step); assert!(matches!(receipt.outcome, config::Outcome::Success));
        assert!(matches!(receipt.owner_status.as_deref(), Some("SUCCESS" | "UNCHANGED")));
        let actual = serde_json::to_value(receipt.committed.as_ref().expect("Missing committed settings")).unwrap();
        let expected = serde_json::to_value(&planned.desired).unwrap();
        for key in if step == "run_mode" { vec!["run_mode", "root"] } else { vec![step.as_str()] } {
            assert_eq!(actual.get(key), expected.get(key));
        }
    }
    let after = inspect(harness, session);
    assert_eq!(after.current.account, selection.account); assert_eq!(after.effective.account, selection.account.profile_name);
    assert_eq!(after.current.model.id, model.id); assert_eq!(after.current.model.reasoning_effort, *effort);
    assert_eq!(after.current.service_tier, *tier); assert_eq!(after.current.run_mode, "direct-run");
    assert_eq!(after.current.target, "workspace"); assert_eq!(after.current.root.replace('\\', "/"), selection.runner_root);
    assert_eq!(after.effective.model, model.id); assert_eq!(after.effective.reasoning_effort, *effort);
    assert_eq!(after.effective.service_tier, *tier);
    assert!(!after.setup_required); assert_eq!(serde_json::to_value(test_selection(harness, session)).unwrap(), serde_json::to_value(&selection).unwrap());
    println!("TEST_RUNNER_CONFIG account={:?}, CODEX_HOME={}, root={}, receipts={:?}, effective={:?}", selection.account, selection.codex_home, selection.runner_root, receipt.results, after.effective);
    selection
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
    assert!(capability.test_account_selection, "Configure /account → Test account settings; Runner must support test selection.");
    let selected = test_selection(&mut harness, &session);
    let unchanged = inspect(&mut harness, &session);
    assert_eq!(actual.revision, unchanged.revision);
    assert_eq!(actual.current.account, unchanged.current.account);
    println!("READ_ONLY_TEST_SELECTION {:?}", selected);
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
    let stale_options = call(&mut harness, &first, config::Request::Inspect { api_version:1, account:None, offset:Some(0),
        options_revision:original.options_revision.clone(), execution_context:None });
    assert_eq!(stale_options.code.as_deref(), Some("CONFIG_OPTIONS_REVISION_STALE"));
    for (mode, direct_root) in [("direct-run", Some(root.clone())), ("task-run", None)] {
        let planned = plan(&mut harness, &first, config::Desired { run_mode:Some(mode.into()), root:direct_root, ..Default::default() });
        assert_eq!(call(&mut harness, &first, apply_request(&planned)).state, "accepted");
        assert_eq!(inspect(&mut harness, &first).current.run_mode, mode);
    }
    first.control_command("/status".into()).unwrap(); harness.pump_for(Duration::from_secs(2));
    assert_eq!(first.control_snapshot().unwrap().results.last().unwrap().state, "accepted");
    assert!(first.control_snapshot().unwrap().references.capability.is_some());
    assert!(first.images_list().unwrap().images.is_empty());
    first.resize(90, 30).unwrap(); second.resize(95, 30).unwrap();
    first.close().unwrap(); harness.exited(&first_id);
    assert_eq!(first.control_snapshot().unwrap().state, "disconnected");
    assert_eq!(second.control_snapshot().unwrap().state, "ready");
    second.close().unwrap(); harness.exited(&second_id);
    assert!(harness.sessions.sessions.lock().unwrap().is_empty());
    println!("Hub native Client: two public Runner identities, capability/options guard, exact plan/apply receipts, final inspect, stale/foreign rejection, v1/images/PTY and owned cleanup passed. Provider model catalogs were not exercised.");
}
