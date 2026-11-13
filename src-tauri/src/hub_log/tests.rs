use super::*;
use std::path::PathBuf;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("hub-log-{}-{}", std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        Self(root)
    }
    fn call(&self, days: u32, event: Option<Event>, now: u64) -> Result<History, String> {
        transact(&self.0, Request { retention_days: days, event }, now)
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn event(code: &str) -> Event {
    Event { component: "configuration".into(), operation: "apply".into(), runner: "owned-runner".into(),
        target: "Project/Example".into(), expected: "completed-receipt".into(), actual: "rejected".into(),
        code: code.into(), next_action: "inspect-configuration-receipt".into() }
}
#[test]
fn disk_roundtrip_restart_order_and_age_cleanup() {
    let fixture = Fixture::new();
    let day = 86_400_000;
    let first = fixture.call(30, Some(event("FIRST")), day).unwrap().records;
    let second = fixture.call(30, Some(event("SECOND")), 2 * day).unwrap().records;
    assert_eq!(second[0].sequence, first[0].sequence);
    assert_eq!(fixture.call(30, None, 2 * day).unwrap().records.len(), 2);
    let retained = fixture.call(1, None, 3 * day).unwrap().records;
    assert_eq!(retained.len(), 1); assert_eq!(retained[0].event.code, "SECOND");
    let third = fixture.call(1, Some(event("THIRD")), 3 * day).unwrap().records;
    assert!(third[1].sequence > third[0].sequence);
    assert_eq!(fixture.call(30, None, 3 * day).unwrap().records.len(), 2);
}
#[test]
fn parse_failure_preserves_original_and_salvages_valid_lines() {
    let fixture = Fixture::new();
    fixture.call(30, Some(event("VALID")), 1).unwrap();
    let path = fixture.0.join("events.jsonl");
    OpenOptions::new().append(true).open(&path).unwrap().write_all(b"{broken\n").unwrap();
    let before = fs::read(&path).unwrap();
    let result = fixture.call(30, Some(event("UNSAVED")), 2).unwrap();
    assert_eq!(result.issue.as_deref(), Some("HUB_LOG_PARSE_FAILED"));
    assert_eq!(result.records.len(), 1); assert_eq!(before, fs::read(path).unwrap());
}
#[test]
fn io_failures_never_replace_valid_history() {
    let fixture = Fixture::new();
    fixture.call(30, Some(event("VALID")), 1).unwrap();
    let path = fixture.0.join("events.jsonl"); let before = fs::read(&path).unwrap();
    fs::create_dir(fixture.0.join("events.staging")).unwrap();
    let failed_prune = fixture.call(1, None, 2 * 86_400_000).unwrap();
    assert_eq!(failed_prune.issue.as_deref(), Some("HUB_LOG_PRUNE_FAILED"));
    assert_eq!(failed_prune.records.len(), 1);
    assert_eq!(before, fs::read(&path).unwrap());
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true); fs::set_permissions(&path, permissions.clone()).unwrap();
    let failed_write = fixture.call(30, Some(event("UNSAVED")), 2).unwrap();
    permissions.set_readonly(false); fs::set_permissions(&path, permissions).unwrap();
    assert_eq!(failed_write.issue.as_deref(), Some("HUB_LOG_WRITE_FAILED"));
    assert_eq!(failed_write.records.len(), 1);
    assert_eq!(before, fs::read(&path).unwrap());
    fs::remove_file(&path).unwrap(); fs::create_dir(path).unwrap();
    assert_eq!(fixture.call(30, None, 1).err().as_deref(), Some("HUB_LOG_READ_FAILED"));
    assert!(fixture.call(0, Some(event("INVALID")), 1).is_err());
}
