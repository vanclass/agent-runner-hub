use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
#[path = "process.rs"] mod process;
#[path = "startup.rs"] mod startup;
#[path = "runner.rs"] pub(super) mod runner;
#[cfg(windows)]
#[path = "job.rs"] mod job;
use process::ProcessKiller;
use startup::InitialCursor;
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, HashMap, HashSet}, io::{Read, Write},
    sync::{Arc, Condvar, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, thread};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub runner_location: Option<String>,
    pub program: Option<String>,
    #[serde(default)] pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)] pub env: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Output { id: String, sequence: u64, bytes: Vec<u8> },
    Exit { id: String, code: Option<u32>, error: Option<String> },
}

type Sink = Arc<dyn Fn(PtyEvent) -> Result<(), String> + Send + Sync>;
type Registry = Arc<Mutex<HashMap<String, Arc<Session>>>>;

pub struct Session {
    owner: String,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Option<ProcessKiller>>,
    #[cfg(windows)] job: Mutex<Option<Arc<job::Job>>>,
    closing: AtomicBool,
    startup_ready: Mutex<bool>,
    started: Condvar,
    acknowledged: Mutex<u64>,
    drained: Condvar,
}

fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if cols == 0 || rows == 0 { return Err("PTY dimensions must be positive".into()); }
    Ok(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
}

impl Session {
    pub fn write(&self, bytes: &[u8]) -> Result<(), String> {
        let mut ready = self.startup_ready.lock().map_err(|e| e.to_string())?;
        while !*ready && !self.closing.load(Ordering::Acquire) {
            ready = self.started.wait(ready).map_err(|e| e.to_string())?;
        }
        drop(ready);
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        if self.closing.load(Ordering::Acquire) { return Err("PTY is closing".into()); }
        writer.as_mut().ok_or("PTY has exited")?.write_all(bytes).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let dimensions = size(cols, rows)?;
        if self.closing.load(Ordering::Acquire) { return Err("PTY is closing".into()); }
        self.master.lock().map_err(|e| e.to_string())?.as_ref()
            .ok_or("PTY has exited")?.resize(dimensions).map_err(|e| e.to_string())
    }

    pub fn acknowledge(&self, sequence: u64) -> Result<(), String> {
        let mut ack = self.acknowledged.lock().map_err(|e| e.to_string())?;
        *ack = (*ack).max(sequence);
        self.drained.notify_all();
        Ok(())
    }

    pub fn close(&self) -> Result<(), String> {
        self.closing.store(true, Ordering::Release);
        self.drained.notify_all();
        self.started.notify_all();
        #[cfg(windows)]
        if let Some(job) = self.job.lock().map_err(|e| e.to_string())?.as_ref() {
            // A successful job teardown already terminated the root. TerminateProcess
            // can reject a second request while that process is finishing termination.
            let result = job.terminate();
            if result.is_err() {
                if let Some(killer) = self.killer.lock().map_err(|e| e.to_string())?.as_mut() { let _ = killer.kill(); }
            }
            return result;
        }
        self.killer.lock().map_err(|e| e.to_string())?.as_mut().map_or(Ok(()), ProcessKiller::kill)
    }
}

#[derive(Default)]
pub struct Sessions { sessions: Registry, closed_owners: Mutex<HashSet<String>>, next: AtomicU64 }

impl Sessions {
    pub fn owned(&self, id: &str, owner: &str) -> Result<Arc<Session>, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(id).ok_or("Unknown or exited PTY")?;
        if session.owner != owner { return Err("PTY belongs to another window".into()); }
        Ok(session.clone())
    }

    pub fn close_window(&self, owner: &str) {
        let sessions = {
            let mut closed = self.closed_owners.lock().unwrap();
            closed.insert(owner.into());
            self.sessions.lock().unwrap().values().filter(|s| s.owner == owner).cloned().collect::<Vec<_>>()
        };
        for session in sessions {
            if let Err(error) = session.close() { eprintln!("PTY termination: {error}"); }
        }
    }

    pub fn reserve(&self, owner: String) -> Result<(String, Arc<Session>), String> {
        let closed = self.closed_owners.lock().map_err(|e| e.to_string())?;
        if closed.contains(&owner) { return Err("PTY window has closed".into()); }
        let id = self.next.fetch_add(1, Ordering::Relaxed).to_string();
        let session = Arc::new(Session { owner, master: Mutex::new(None), writer: Mutex::new(None),
            killer: Mutex::new(None), closing: AtomicBool::new(false),
            #[cfg(windows)] job: Mutex::new(None),
            startup_ready: Mutex::new(!cfg!(windows)), started: Condvar::new(),
            acknowledged: Mutex::new(0), drained: Condvar::new() });
        self.sessions.lock().map_err(|e| e.to_string())?.insert(id.clone(), session.clone());
        Ok((id, session))
    }

    pub fn start(&self, id: String, session: Arc<Session>, request: OpenRequest, sink: Sink) -> Result<String, String> {
        let result = self.start_inner(id.clone(), session, request, sink);
        if result.is_err() { self.sessions.lock().unwrap().remove(&id); }
        result
    }

    fn start_inner(&self, id: String, session: Arc<Session>, request: OpenRequest, sink: Sink) -> Result<String, String> {
        if session.closing.load(Ordering::Acquire) { return Err("PTY creation cancelled".into()); }
        let contained = request.runner_location.is_some();
        let request = match request.runner_location.as_deref() {
            Some(location) => runner::prepare(location, request.cols, request.rows)?,
            None => request,
        };
        let pair = native_pty_system().openpty(size(request.cols, request.rows)?).map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let default = if cfg!(windows) { std::env::var("COMSPEC").unwrap_or("cmd.exe".into()) }
            else { std::env::var("SHELL").unwrap_or("/bin/zsh".into()) };
        let mut command = CommandBuilder::new(request.program.unwrap_or(default));
        if contained {
            for (key, _) in std::env::vars_os() {
                if key.to_string_lossy().starts_with("AGENT_RUNNER_") { command.env_remove(key); }
            }
            command.env_remove("PYTHONPATH"); command.env_remove("PYTHONHOME");
            #[cfg(windows)] {
                let job = Arc::new(job::Job::new()?);
                job.configure(&mut command);
                *session.job.lock().unwrap() = Some(job);
            }
        }
        command.args(request.args);
        if let Some(cwd) = request.cwd { command.cwd(cwd); }
        for (key, value) in request.env { command.env(key, value); }
        command.env("TERM", "xterm-256color");
        *session.master.lock().unwrap() = Some(pair.master);
        *session.writer.lock().unwrap() = Some(writer);
        let output_session = session.clone();
        let output_id = id.clone();
        let output_sink = sink.clone();
        let output = thread::spawn(move || -> Result<(), String> {
            let mut bytes = [0u8; 8192];
            let mut sequence = 0;
            let mut cursor = InitialCursor::new(cfg!(windows));
            let mut delivery_error = None;
            loop {
                let count = match reader.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(count) => count,
                    Err(error) => { let _ = output_session.close(); return Err(error.to_string()); }
                };
                let (answer, forwarded) = cursor.push(&bytes[..count]);
                if answer {
                    // ConPTY startup must complete even if the renderer has already gone away.
                    if let Some(writer) = output_session.writer.lock().unwrap().as_mut() {
                        writer.write_all(b"\x1b[1;1R").map_err(|e| e.to_string())?;
                    }
                    *output_session.startup_ready.lock().unwrap() = true;
                    output_session.started.notify_all();
                }
                if forwarded.is_empty() || output_session.closing.load(Ordering::Acquire) { continue; }
                sequence += 1;
                if let Err(error) = output_sink(PtyEvent::Output { id: output_id.clone(), sequence, bytes: forwarded }) {
                    let _ = output_session.close();
                    delivery_error = Some(error);
                    continue;
                }
                let mut ack = output_session.acknowledged.lock().unwrap();
                while *ack < sequence && !output_session.closing.load(Ordering::Acquire) {
                    ack = output_session.drained.wait(ack).unwrap();
                }
            }
            delivery_error.map_or(Ok(()), Err)
        });
        let spawned = if session.closing.load(Ordering::Acquire) { Err("PTY creation cancelled".into()) }
            else { pair.slave.spawn_command(command).map_err(|e| e.to_string()) };
        drop(pair.slave);
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                let _ = session.close();
                session.master.lock().unwrap().take();
                session.writer.lock().unwrap().take();
                let _ = output.join();
                return Err(error);
            }
        };
        let captured = ProcessKiller::capture(child.as_ref());
        if let Err(error) = captured {
            let termination = process::terminate_child(child.as_mut());
            let _ = session.close();
            let _ = child.wait();
            session.master.lock().unwrap().take();
            session.writer.lock().unwrap().take();
            let _ = output.join();
            return Err(format!("{error}; termination: {termination:?}"));
        }
        {
            let mut killer = session.killer.lock().unwrap();
            *killer = Some(captured.unwrap());
            if session.closing.load(Ordering::Acquire) {
                if let Err(error) = killer.as_mut().unwrap().kill() { eprintln!("PTY cancellation: {error}"); }
            }
        }
        let registry = self.sessions.clone();
        let exit_id = id.clone();
        thread::spawn(move || {
            let status = child.wait();
            // A root exit does not release descendants. Settle its job before publishing Exit.
            #[cfg(windows)]
            let containment = session.job.lock().unwrap().as_ref().map_or(Ok(()), |job| job.terminate());
            // Close ConPTY away from its reader while that reader can still drain output.
            session.master.lock().unwrap().take();
            session.writer.lock().unwrap().take();
            session.killer.lock().unwrap().take();
            let read_result = output.join().unwrap_or_else(|_| Err("PTY reader panicked".into()));
            let error = status.as_ref().err().map(ToString::to_string).or_else(|| read_result.err());
            #[cfg(windows)] let error = error.or_else(|| containment.err());
            let code = status.ok().map(|s| s.exit_code());
            let _ = sink(PtyEvent::Exit { id: exit_id.clone(), code, error });
            registry.lock().unwrap().remove(&exit_id);
        });
        Ok(id)
    }
}

impl Drop for Sessions {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() { let _ = session.close(); }
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
