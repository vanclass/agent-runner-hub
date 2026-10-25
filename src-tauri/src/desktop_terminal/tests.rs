use super::*;
use std::{io::{BufRead, Write}, sync::mpsc, time::Duration};
#[cfg(windows)]
#[path = "clipboard_acceptance.rs"] mod clipboard_acceptance;

#[test]
#[ignore = "Requires an explicitly configured installed Runner on a native host"]
fn installed_runner_interactive_probe() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").expect("installed workspace root");
    let mut harness = Harness::new();
    let (id, session) = harness.sessions.reserve("test-window".into()).unwrap();
    let id = harness.sessions.start(id, session, OpenRequest {
        runner_location: Some(root), cols: 100, rows: 35,
        ..Default::default()
    }, harness.sink.clone()).unwrap();
    harness.pump_for(Duration::from_secs(12));
    let pty = harness.sessions.owned(&id, "test-window").unwrap();
    for command in ["/status", "/help", "/hub-unknown\n\u{c548}\u{b155} \u{1f30d}"] {
        pty.write(win32_text(command).as_bytes()).unwrap();
        harness.pump_for(Duration::from_secs(1));
        pty.write(b"\x1b[13;0;13;1;0;1_").unwrap();
        harness.pump_for(Duration::from_secs(3));
    }
    pty.resize(90, 30).unwrap();
    for keys in ["\x1b[27;0;27;1;0;1_", "\x1b[67;0;3;1;8;1_", "\x1b[40;0;0;1;0;1_", "\x1b[13;0;13;1;0;1_"] {
        if harness.exited.contains_key(&id) { break; }
        pty.write(keys.as_bytes()).unwrap();
        harness.pump_for(Duration::from_secs(2));
    }
    harness.pump_for(Duration::from_secs(10));
    println!("{}", String::from_utf8_lossy(&harness.output[&id]));
    let text = String::from_utf8_lossy(&harness.output[&id]);
    assert!(text.contains("/status") && text.contains("hub-unknown") && text.contains("\u{c548}\u{b155}") && text.contains("\u{1f30d}"));
    assert_eq!(harness.exited.get(&id), Some(&Some(0)), "Runner must exit normally");
}

fn win32_text(text: &str) -> String {
    text.encode_utf16().map(|unit| {
        if unit == 10 { "\x1b[13;0;13;1;16;1_".to_string() }
        else { format!("\x1b[0;0;{unit};1;0;1_") }
    }).collect()
}

#[test]
#[ignore = "Requires an explicitly configured installed Runner on Windows"]
fn installed_runners_independent_and_owned_shutdown() {
    let root = std::env::var("HUB_RUNNER_ACCEPTANCE_ROOT").unwrap();
    let mut harness = Harness::new();
    let mut unrelated = Harness::new();
    let untouched = unrelated.open("wait"); unrelated.ready(&untouched);
    let first = harness.open_runner(&root);
    let second = harness.open_runner(&root);
    let first_pty = harness.sessions.owned(&first, "test-window").unwrap();
    let second_pty = harness.sessions.owned(&second, "test-window").unwrap();
    harness.pump_for(Duration::from_secs(12));
    assert!(!Arc::ptr_eq(&first_pty, &second_pty));
    let control_deadline = std::time::Instant::now() + Duration::from_secs(35);
    while std::time::Instant::now() < control_deadline &&
        [first_pty.control_snapshot().unwrap(), second_pty.control_snapshot().unwrap()].iter().any(|s| s.state == "connecting") {
        harness.pump_for(Duration::from_millis(100));
    }
    let connected = first_pty.control_snapshot().unwrap();
    assert_eq!(connected.state, "ready", "{:?}; {}", connected.detail,
        String::from_utf8_lossy(harness.output.get(&first).map(Vec::as_slice).unwrap_or_default()));
    assert_eq!(second_pty.control_snapshot().unwrap().state, "ready");
    assert!(first_pty.control_snapshot().unwrap().observation.is_some());
    first_pty.control_command("/status".into()).unwrap();
    harness.pump_for(Duration::from_secs(3));
    let first_control = first_pty.control_snapshot().unwrap();
    assert_eq!(first_control.results.last().unwrap().state, "accepted");
    assert!(second_pty.control_snapshot().unwrap().results.is_empty());
    first_pty.control_command("/model".into()).unwrap();
    harness.pump_for(Duration::from_secs(2));
    assert_eq!(first_pty.control_snapshot().unwrap().results.last().unwrap().state, "pending-interaction");
    first_pty.write(b"\x1b[27;0;27;1;0;1_").unwrap();
    harness.pump_for(Duration::from_secs(2));
    assert_eq!(first_pty.control_snapshot().unwrap().results.last().unwrap().state, "rejected");
    assert_eq!(first_pty.control_snapshot().unwrap().results.last().unwrap().owner_status.as_deref(), Some("CANCELLED"));
    first_pty.write((win32_text("/hub-first\n\u{c548}\u{b155} \u{1f30d}") + "\x1b[13;0;13;1;0;1_").as_bytes()).unwrap();
    second_pty.write((win32_text("/hub-second\n\u{4e16}\u{754c}") + "\x1b[13;0;13;1;0;1_").as_bytes()).unwrap();
    harness.pump_for(Duration::from_secs(4));
    let a = String::from_utf8_lossy(&harness.output[&first]);
    let b = String::from_utf8_lossy(&harness.output[&second]);
    assert!(a.contains("hub-first") && a.contains("\u{c548}\u{b155}") && a.contains("\u{1f30d}") && !a.contains("hub-second"));
    assert!(b.contains("hub-second") && !b.contains("hub-first"));
    for index in 0..8 {
        let selected = if index % 2 == 0 { &first_pty } else { &second_pty };
        selected.resize(90 + index, 30).unwrap();
    }
    first_pty.close().unwrap();
    harness.exited(&first);
    assert_eq!(first_pty.control_snapshot().unwrap().state, "disconnected");
    assert_eq!(second_pty.control_snapshot().unwrap().state, "ready");
    assert!(harness.sessions.owned(&first, "test-window").is_err());
    second_pty.write((win32_text("/status") + "\x1b[13;0;13;1;0;1_").as_bytes()).unwrap();
    harness.pump_for(Duration::from_secs(3));
    assert!(Arc::ptr_eq(&second_pty, &harness.sessions.owned(&second, "test-window").unwrap()));
    assert!(String::from_utf8_lossy(&harness.output[&second]).contains("/status"));
    harness.sessions.close_window("test-window");
    harness.exited(&second);
    assert!(harness.sessions.sessions.lock().unwrap().is_empty());
    let untouched_pty = unrelated.sessions.owned(&untouched, "test-window").unwrap();
    untouched_pty.resize(90, 30).unwrap();
    untouched_pty.close().unwrap(); unrelated.exited(&untouched);
    println!("Actual installed Runners: isolated Unicode/multiline I/O, stable sessions, individual termination, empty jobs on window shutdown; unrelated owned fixture survived.");
}

#[test]
#[ignore = "Child fixture, launched only by the PTY tests"]
fn child_fixture() {
    let mode = std::env::var("DESKTOP_PTY_TEST_CHILD").expect("owned child marker");
    println!("ready: \u{c548}\u{b155} \u{1f30d}");
    std::io::stdout().flush().unwrap();
    if mode == "echo" {
        let mut line = String::new();
        std::io::stdin().lock().read_line(&mut line).unwrap();
        print!("received:{line}");
        std::io::stdout().flush().unwrap();
    } else {
        loop {
            if mode == "output" { print!("\x1b[32moutput\x1b[0m"); std::io::stdout().flush().unwrap(); }
            else { thread::park(); }
        }
    }
}

struct Harness {
    sessions: Arc<Sessions>,
    events: mpsc::Receiver<PtyEvent>,
    sink: Sink,
    output: HashMap<String, Vec<u8>>,
    exited: HashMap<String, Option<u32>>,
}

impl Harness {
    fn new() -> Self {
        let (sender, events) = mpsc::channel();
        Self { sessions: Arc::new(Sessions::default()), events,
            sink: Arc::new(move |event| sender.send(event).map_err(|e| e.to_string())),
            output: HashMap::new(), exited: HashMap::new() }
    }
    fn open(&self, mode: &str) -> String {
        let (id, session) = self.sessions.reserve("test-window".into()).unwrap();
        self.sessions.start(id, session, OpenRequest {
            program: Some(std::env::current_exe().unwrap().to_string_lossy().into_owned()),
            args: vec!["--ignored".into(), "--exact".into(), "desktop_terminal::pty::tests::child_fixture".into(), "--nocapture".into()],
            env: [("DESKTOP_PTY_TEST_CHILD".into(), mode.into())].into(),
            cols: 80, rows: 24, ..Default::default()
        }, self.sink.clone()).unwrap()
    }
    fn open_runner(&self, location: &str) -> String {
        let (id, session) = self.sessions.reserve("test-window".into()).unwrap();
        self.sessions.start(id, session, OpenRequest {
            runner_location: Some(location.into()), cols: 100, rows: 35, ..Default::default()
        }, self.sink.clone()).unwrap()
    }
    fn event(&mut self) {
        let event = self.events.recv_timeout(Duration::from_secs(30)).unwrap_or_else(|error| {
            let output: HashMap<_, _> = self.output.iter().map(|(id, bytes)| (id, String::from_utf8_lossy(bytes))).collect();
            panic!("owned PTY must settle: {error}; output={output:?}; exits={:?}", self.exited);
        });
        self.accept(event);
    }
    fn pump_for(&mut self, duration: Duration) {
        let until = std::time::Instant::now() + duration;
        while let Some(remaining) = until.checked_duration_since(std::time::Instant::now()) {
            match self.events.recv_timeout(remaining) {
                Ok(event) => self.accept(event),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(error) => panic!("PTY event channel: {error}"),
            }
        }
    }
    fn accept(&mut self, event: PtyEvent) {
        match event {
            PtyEvent::Output { id, sequence, bytes } => {
                self.output.entry(id.clone()).or_default().extend(bytes);
                self.sessions.owned(&id, "test-window").unwrap().acknowledge(sequence).unwrap();
            }
            PtyEvent::Exit { id, code, error, .. } => {
                assert!(error.is_none(), "PTY stream/wait failure: {error:?}");
                self.exited.insert(id, code);
            }
        }
    }
    fn ready(&mut self, id: &str) {
        while !String::from_utf8_lossy(self.output.get(id).map(Vec::as_slice).unwrap_or_default()).contains("ready:") { self.event(); }
    }
    fn exited(&mut self, id: &str) {
        while !self.exited.contains_key(id) { self.event(); }
    }
}

impl Drop for Harness {
    fn drop(&mut self) { self.sessions.close_window("test-window"); }
}

#[test]
fn independent_unicode_input_resize_exit_and_termination() {
    let mut harness = Harness::new();
    let first = harness.open("echo");
    let second = harness.open("wait");
    assert_ne!(first, second);
    harness.ready(&first); harness.ready(&second);
    let session = harness.sessions.owned(&first, "test-window").unwrap();
    assert!(harness.sessions.owned(&first, "another-window").is_err());
    assert!(session.resize(0, 30).is_err());
    session.resize(100, 32).unwrap();
    session.write("input \u{4e16}\u{754c}\r\n".as_bytes()).unwrap();
    harness.exited(&first);
    let output = String::from_utf8(harness.output[&first].clone()).expect("complete UTF-8 stream");
    assert!(output.contains("\u{c548}\u{b155} \u{1f30d}"), "{output}");
    assert!(output.contains("received:input \u{4e16}\u{754c}"), "{output}");
    assert_eq!(harness.exited[&first], Some(0));
    let remaining = harness.sessions.owned(&second, "test-window").unwrap();
    remaining.resize(90, 28).unwrap();
    remaining.close().unwrap();
    remaining.close().unwrap();
    harness.exited(&second);
}

#[test]
fn native_shell_output() {
    let mut harness = Harness::new();
    let (program, args) = if cfg!(windows) { ("cmd.exe", vec!["/d", "/c", "echo ready: native"]) }
        else { ("/bin/sh", vec!["-c", "printf 'ready: native\\n'"]) };
    let (id, session) = harness.sessions.reserve("test-window".into()).unwrap();
    let id = harness.sessions.start(id, session, OpenRequest {
        program: Some(program.into()), args: args.into_iter().map(String::from).collect(),
        cols: 80, rows: 24, ..Default::default()
    }, harness.sink.clone()).unwrap();
    harness.ready(&id);
    harness.exited(&id);
    assert_eq!(harness.exited[&id], Some(0));
}

#[test]
fn termination_unblocks_unacknowledged_output() {
    let mut harness = Harness::new();
    let id = harness.open("output");
    let event = harness.events.recv_timeout(Duration::from_secs(30)).unwrap();
    assert!(matches!(event, PtyEvent::Output { .. }));
    let session = harness.sessions.owned(&id, "test-window").unwrap();
    session.close().unwrap();
    harness.exited(&id);
}

#[test]
fn destroyed_window_cancels_pending_creation_and_rejects_late_requests() {
    let harness = Harness::new();
    let (id, session) = harness.sessions.reserve("test-window".into()).unwrap();
    harness.sessions.close_window("test-window");
    assert!(harness.sessions.start(id.clone(), session, OpenRequest {
        cols: 80, rows: 24, ..Default::default()
    }, harness.sink.clone()).unwrap_err().contains("cancelled"));
    assert!(harness.sessions.owned(&id, "test-window").is_err());
    assert!(harness.sessions.reserve("test-window".into()).is_err());
}
