use super::*;
use std::{io::{BufRead, Write}, sync::mpsc, time::Duration};

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
    fn event(&mut self) {
        let event = self.events.recv_timeout(Duration::from_secs(30)).unwrap_or_else(|error| {
            let output: HashMap<_, _> = self.output.iter().map(|(id, bytes)| (id, String::from_utf8_lossy(bytes))).collect();
            panic!("owned PTY must settle: {error}; output={output:?}; exits={:?}", self.exited);
        });
        match event {
            PtyEvent::Output { id, sequence, bytes } => {
                self.output.entry(id.clone()).or_default().extend(bytes);
                self.sessions.owned(&id, "test-window").unwrap().acknowledge(sequence).unwrap();
            }
            PtyEvent::Exit { id, code, error } => {
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
