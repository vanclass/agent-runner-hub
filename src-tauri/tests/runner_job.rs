#![cfg(all(windows, feature = "desktop-terminal"))]

// Exercise the production Job and vendored ConPTY spawn path without a Runner install.
#[path = "../src/desktop_terminal/job.rs"]
mod job;
#[path = "../src/desktop_terminal/startup.rs"]
mod startup;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, process::Command, thread, time::{Duration, Instant}};
use std::os::windows::{io::{AsRawHandle, FromRawHandle, OwnedHandle}, process::CommandExt};
use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE};

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../temp");
        fs::create_dir_all(&root).unwrap();
        let name = format!("job-fixture-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let path = root.join(name);
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

fn wait_until(predicate: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !predicate() {
        assert!(Instant::now() < deadline, "owned fixture readiness timeout");
        thread::sleep(Duration::from_millis(10));
    }
}

fn observed_process(pid: u32) -> OwnedHandle {
    // Read-only lifetime observation; cleanup acts only through the owned Job.
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    assert!(!handle.is_null(), "fixture process must still be held alive");
    unsafe { OwnedHandle::from_raw_handle(handle) }
}

fn ended(handle: &OwnedHandle) -> bool {
    unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) == 0 }
}

fn fixture_arguments(command: &mut Command, directory: &Path, mode: &str) {
    command.args(["--ignored", "--exact", "child_fixture", "--nocapture"])
        .env("HUB_JOB_FIXTURE", directory).env("HUB_JOB_MODE", mode);
}

#[test]
#[ignore = "Bounded child entrypoint; launched only by this fixture"]
fn child_fixture() {
    let directory = PathBuf::from(std::env::var_os("HUB_JOB_FIXTURE").unwrap());
    let mode = std::env::var("HUB_JOB_MODE").unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    if mode == "leaf" || mode == "unrelated" {
        fs::write(directory.join(&mode), std::process::id().to_string()).unwrap();
        while Instant::now() < deadline { thread::sleep(Duration::from_millis(20)); }
        return;
    }
    let mut command = Command::new(std::env::current_exe().unwrap());
    fixture_arguments(&mut command, &directory, "leaf");
    // A detached process with a new process group must still inherit its Job.
    command.creation_flags(0x00000008 | 0x00000200);
    let mut child = command.spawn().unwrap();
    fs::write(directory.join("created"), child.id().to_string()).unwrap();
    while Instant::now() < deadline {
        if mode == "root-exit" && directory.join("release").exists() { return; }
        thread::sleep(Duration::from_millis(20));
    }
    let _ = child.wait();
}

struct Session {
    job: Option<job::Job>,
    child: Box<dyn Child + Send + Sync>,
    pair: Option<portable_pty::PtyPair>,
    output: Option<thread::JoinHandle<()>>,
    descendant: OwnedHandle,
    directory: Directory,
}
impl Session {
    fn start(mode: &str) -> Self {
        let directory = Directory::new();
        let job = job::Job::new().unwrap();
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        // Match production: service the inherited cursor query before spawn.
        let output = thread::spawn(move || {
            let mut cursor = startup::InitialCursor::new(true);
            let mut bytes = [0u8; 4096];
            while let Ok(count) = reader.read(&mut bytes) {
                if count == 0 { break; }
                if cursor.push(&bytes[..count]).0 {
                    if writer.write_all(b"\x1b[1;1R").is_err() { break; }
                }
            }
        });
        let mut command = CommandBuilder::new(std::env::current_exe().unwrap());
        command.args(["--ignored", "--exact", "child_fixture", "--nocapture"]);
        command.env("HUB_JOB_FIXTURE", &directory.0);
        command.env("HUB_JOB_MODE", mode);
        job.configure(&mut command);
        let child = pair.slave.spawn_command(command).unwrap();
        wait_until(|| directory.0.join("created").exists() && directory.0.join("leaf").exists());
        let pid: u32 = fs::read_to_string(directory.0.join("created")).unwrap().parse().unwrap();
        assert_eq!(fs::read_to_string(directory.0.join("leaf")).unwrap(), pid.to_string());
        let descendant = observed_process(pid);
        assert!(!ended(&descendant));
        Self { job: Some(job), child, pair: Some(pair), output: Some(output), descendant, directory }
    }
    fn terminate(&self) {
        self.job.as_ref().unwrap().terminate().unwrap();
        wait_until(|| ended(&self.descendant));
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Some(job) = &self.job { let _ = job.terminate(); }
        let _ = self.child.wait();
        drop(self.pair.take());
        if let Some(output) = self.output.take() { output.join().unwrap(); }
    }
}

#[test]
fn job_contains_detached_descendants_and_isolates_sessions() {
    let directory = Directory::new();
    let mut unrelated = Command::new(std::env::current_exe().unwrap());
    fixture_arguments(&mut unrelated, &directory.0, "unrelated");
    let mut unrelated = unrelated.spawn().unwrap();
    let first = Session::start("root");
    let second = Session::start("root");
    first.terminate();
    assert!(!ended(&second.descendant));
    assert!(unrelated.try_wait().unwrap().is_none());
    second.terminate();
    assert!(unrelated.try_wait().unwrap().is_none());
    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
}

#[test]
fn root_exit_and_final_handle_close_settle_owned_descendants() {
    let mut natural = Session::start("root-exit");
    fs::write(natural.directory.0.join("release"), b"go").unwrap();
    assert!(natural.child.wait().unwrap().success());
    assert!(!ended(&natural.descendant), "root exit alone must leave the owned descendant");
    natural.terminate();
    let mut dropped = Session::start("root");
    drop(dropped.job.take());
    wait_until(|| ended(&dropped.descendant));
    dropped.child.wait().unwrap();
}
