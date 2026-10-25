//! Opt-in installed-Runner acceptance through the existing native session fixture.
use super::*;
use super::super::control::references::{ReferenceAdmission, ReferenceRequest, ReferenceResult};

fn image() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
        encoder.set_color(png::ColorType::Rgba); encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().unwrap().write_image_data(&[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
    }
    bytes
}
fn wait_ready(harness: &mut Harness, session: &Session) {
    let deadline = std::time::Instant::now() + Duration::from_secs(40);
    loop {
        let snapshot = session.control_snapshot().unwrap();
        if snapshot.state == "ready" && snapshot.references.capability.is_some()
            && snapshot.observation.as_ref().is_some_and(|o| o.commands.iter().any(|c| c.text == "/files" && c.enabled)) { return; }
        assert!(std::time::Instant::now() < deadline, "installed authenticated reference capability unavailable: {:?}", snapshot.detail);
        harness.pump_for(Duration::from_millis(50));
    }
}
fn submit(session: &Session, request: ReferenceRequest) -> u64 {
    match session.control_reference(request).unwrap() {
        ReferenceAdmission::Admitted { id } => id,
        _ => panic!("installed Runner did not admit the reference request"),
    }
}
fn wait_result(harness: &mut Harness, session: &Session, id: u64) -> ReferenceResult {
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(result) = session.control_snapshot().unwrap().references.results.iter().find(|r| r.id == id) {
            if !matches!(result.state.as_str(), "sending" | "queued") { return result.clone(); }
        }
        assert!(std::time::Instant::now() < deadline, "reference request did not settle or request interaction");
        harness.pump_for(Duration::from_millis(50));
    }
}
fn answer(harness: &mut Harness, session: &Session, id: u64, cancel: bool) -> ReferenceResult {
    let pending = wait_result(harness, session, id);
    assert_eq!(pending.state, "pending-interaction", "image-detail terminal flow is unavailable under current Runner preferences");
    assert!(pending.reference.is_none());
    session.write(if cancel { b"\x1b[27;0;27;1;0;1_" } else { b"\x1b[13;0;13;1;0;1_" }).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let result = wait_result(harness, session, id);
        if result.state != "pending-interaction" { return result; }
        assert!(std::time::Instant::now() < deadline, "image-detail answer did not settle");
        harness.pump_for(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "Requires installed Runner preferences with terminal image-detail selection enabled"]
fn installed_clipboard_terminal_selection_and_cancellation() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let mut harness = Harness::new(); let id = harness.open_runner(&root);
    let session = harness.sessions.owned(&id, "test-window").unwrap(); wait_ready(&mut harness, &session);
    let bytes = image(); let path = session.stage_clipboard(&bytes).unwrap();
    let request = submit(&session, ReferenceRequest::Register { path: path.clone() });
    let cancelled = answer(&mut harness, &session, request, true);
    assert_eq!(cancelled.state, "rejected"); assert!(cancelled.reference.is_none());
    assert_eq!(cancelled.code.as_deref(), Some("REFERENCE_SELECTION_CANCELLED"));
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let request = submit(&session, ReferenceRequest::Register { path: path.clone() });
    assert_eq!(answer(&mut harness, &session, request, false).state, "registered");
    session.close().unwrap(); harness.exited(&id); assert!(!std::path::Path::new(&path).exists());
}

#[test]
#[ignore = "Requires HUB_RUNNER_ACCEPTANCE_ROOT on Windows"]
fn installed_clipboard_staging_receipts_inventory_and_scoped_cleanup() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let mut harness = Harness::new();
    let first = harness.open_runner(&root); let second = harness.open_runner(&root);
    let a = harness.sessions.owned(&first, "test-window").unwrap();
    let b = harness.sessions.owned(&second, "test-window").unwrap();
    wait_ready(&mut harness, &a); wait_ready(&mut harness, &b);
    let bytes = image();
    let path = a.stage_clipboard(&bytes).unwrap();
    let id = submit(&a, ReferenceRequest::Register { path: path.clone() });
    assert_eq!(std::fs::read(&path).unwrap(), bytes, "readable after admission");
    let mut registered = wait_result(&mut harness, &a, id);
    if registered.state == "pending-interaction" { registered = answer(&mut harness, &a, id, false); }
    assert_eq!(registered.state, "registered");
    let stable = registered.reference.unwrap().reference_id;
    let list = submit(&a, ReferenceRequest::List { offset: 0 });
    let inventory = wait_result(&mut harness, &a, list).inventory.unwrap();
    assert!(inventory.references.iter().any(|r| r.reference_id == stable));
    assert_eq!(std::fs::read(&path).unwrap(), bytes, "completed receipt does not release live bytes");
    let python = super::super::runner::resolve(&root).unwrap().python;
    let read = std::process::Command::new(python).args(["-I", "-c",
        "from pathlib import Path; import sys; b=Path(sys.argv[1]).read_bytes(); assert b.startswith(bytes([137,80,78,71,13,10,26,10])); print(len(b))",
        &path]).output().unwrap();
    assert!(read.status.success(), "installed Python must read with the original Hub handle retained");
    assert_eq!(String::from_utf8(read.stdout).unwrap().trim(), bytes.len().to_string());
    let other = b.stage_clipboard(&bytes).unwrap();
    let rejected_id = submit(&a, ReferenceRequest::Register { path: format!("{path}-missing") });
    let rejected = wait_result(&mut harness, &a, rejected_id);
    assert_eq!(rejected.state, "rejected"); assert!(rejected.reference.is_none());
    a.control.lock().unwrap().as_ref().unwrap().close();
    harness.pump_for(Duration::from_secs(1));
    assert_eq!(a.control_snapshot().unwrap().state, "disconnected");
    assert_eq!(std::fs::read(&path).unwrap(), bytes, "disconnect cannot release a live source");
    a.close().unwrap(); harness.exited(&first);
    assert!(!std::path::Path::new(&path).exists());
    assert_eq!(std::fs::read(&other).unwrap(), bytes, "another Runner source survives");
    assert_eq!(b.control_snapshot().unwrap().state, "ready");
    // Exercise the root-exit cleanup path with this fixture's already-owned Job.
    b.job.lock().unwrap().as_ref().unwrap().terminate().unwrap(); harness.exited(&second);
    assert!(!std::path::Path::new(&other).exists());
    println!("Installed Runner reference {stable}: canonical inventory match, rejection, source retention through admission/completion/disconnect, isolated close and root-exit cleanup.");
}
