use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write, path::Path, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Manager, Runtime, State, Window};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub component: String,
    pub operation: String,
    pub runner: String,
    pub target: String,
    pub expected: String,
    pub actual: String,
    pub code: String,
    pub next_action: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record { pub sequence: u64, pub timestamp: u64, #[serde(flatten)] pub event: Event }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request { pub retention_days: u32, pub event: Option<Event> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History { pub records: Vec<Record>, pub issue: Option<String> }
#[derive(Default)]
pub struct Store(Mutex<()>);

fn safe(value: &str) -> bool {
    value.len() <= 256 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:/ -".contains(&b))
}
fn valid(event: &Event) -> bool {
    [&event.component, &event.operation, &event.runner, &event.target, &event.expected,
        &event.actual, &event.code, &event.next_action].iter().all(|s| safe(s))
}

// The native owner serializes restore, append and age cleanup. No view owns disk state.
fn transact(root: &Path, request: Request, now: u64) -> Result<History, String> {
    if request.retention_days == 0 || request.event.as_ref().is_some_and(|e| !valid(e)) {
        return Err("HUB_LOG_INVALID_REQUEST".into());
    }
    fs::create_dir_all(root).map_err(|_| "HUB_LOG_DIRECTORY_FAILED")?;
    let path = root.join("events.jsonl");
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(_) => return Err("HUB_LOG_READ_FAILED".into()),
    };
    let mut records = Vec::new();
    let mut damaged = false;
    for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
        match serde_json::from_slice::<Record>(line) {
            Ok(record) if valid(&record.event) && record.sequence > records.last().map_or(0, |r: &Record| r.sequence) => records.push(record),
            _ => damaged = true,
        }
    }
    // Keep every original byte and expose salvageable history; never overwrite damage.
    if damaged { return Ok(History { records, issue: Some("HUB_LOG_PARSE_FAILED".into()) }); }
    let sequence = records.last().map_or(now.max(1), |r| (r.sequence + 1).max(now));
    let cutoff = now.saturating_sub(u64::from(request.retention_days) * 86_400_000);
    let original_count = records.len();
    let original_records = records.clone();
    records.retain(|r| r.timestamp >= cutoff);
    if records.len() != original_count {
        let staging = root.join("events.staging");
        let result = (|| -> Result<(), std::io::Error> {
            let mut file = OpenOptions::new().write(true).create_new(true).open(&staging)?;
            for record in &records { serde_json::to_writer(&mut file, record)?; file.write_all(b"\n")?; }
            file.sync_all()?;
            drop(file);
            fs::rename(&staging, &path)
        })();
        if result.is_err() {
            // Staging belongs only to this serialized operation, never to arbitrary paths.
            let _ = fs::remove_file(&staging);
            return Ok(History { records: original_records, issue: Some("HUB_LOG_PRUNE_FAILED".into()) });
        }
    }
    if let Some(event) = request.event {
        let record = Record { sequence, timestamp: now, event };
        let mut encoded = serde_json::to_vec(&record).map_err(|_| "HUB_LOG_ENCODE_FAILED")?;
        encoded.push(b'\n');
        let saved = OpenOptions::new().append(true).create(true).open(&path)
            .and_then(|mut file| file.write_all(&encoded).and_then(|_| file.sync_all()));
        if saved.is_err() { return Ok(History { records, issue: Some("HUB_LOG_WRITE_FAILED".into()) }); }
        records.push(record);
    }
    Ok(History { records, issue: None })
}

#[tauri::command]
pub async fn hub_log<R: Runtime>(window: Window<R>, store: State<'_, std::sync::Arc<Store>>, request: Request) -> Result<History, String> {
    if window.label() != "main" { return Err("HUB_LOG_MAIN_WINDOW_ONLY".into()); }
    let root = window.path().app_local_data_dir().map_err(|_| "HUB_LOG_PATH_UNAVAILABLE")?.join("hub-logs");
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = store.0.lock().map_err(|_| "HUB_LOG_LOCK_FAILED")?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "HUB_LOG_CLOCK_FAILED")?.as_millis() as u64;
        transact(&root, request, now)
    }).await.map_err(|_| "HUB_LOG_WORKER_FAILED")?
}

#[cfg(test)]
mod tests;
