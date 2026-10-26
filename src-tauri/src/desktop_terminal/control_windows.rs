use super::{Protocol, Snapshot};
use super::references::{ReferenceAdmission, ReferenceRequest};
use super::generated_images::{self, Images};
use portable_pty::CommandBuilder;
use std::{io, os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, mpsc}, thread, time::{Duration, Instant}};
use windows_sys::Win32::{Foundation::*, Security::{SECURITY_ATTRIBUTES, Cryptography::*},
    Storage::FileSystem::{ReadFile, WriteFile}, System::Pipes::*};

fn error() -> String { format!("Runner control I/O failed ({})", io::Error::last_os_error().raw_os_error().unwrap_or(0)) }
enum Request { Command(String), Reference(ReferenceRequest), Image(generated_images::Request, super::ImageCompletion) }
type Admission = mpsc::Sender<Result<u64, String>>;
struct SubmitError { detail: String, unknown: bool }
impl From<&str> for SubmitError {
    fn from(detail: &str) -> Self { Self { detail: detail.into(), unknown: false } }
}
fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    if unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32,
        BCRYPT_USE_SYSTEM_PREFERRED_RNG) } != 0 { return Err("Secure Runner identity generation failed".into()); }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn pipe(parent_reads: bool) -> Result<(OwnedHandle, OwnedHandle), String> {
    let mut read = std::ptr::null_mut();
    let mut write = std::ptr::null_mut();
    let security = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(), bInheritHandle: 1 };
    if unsafe { CreatePipe(&mut read, &mut write, &security, 65536) } == 0 { return Err(error()); }
    let read = unsafe { OwnedHandle::from_raw_handle(read) };
    let write = unsafe { OwnedHandle::from_raw_handle(write) };
    let (parent, child) = if parent_reads { (read, write) } else { (write, read) };
    if unsafe { SetHandleInformation(parent.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) } == 0 { return Err(error()); }
    if !parent_reads {
        let mode = PIPE_NOWAIT;
        if unsafe { SetNamedPipeHandleState(parent.as_raw_handle(), &mode, std::ptr::null(), std::ptr::null()) } == 0 {
            return Err(error());
        }
    }
    Ok((parent, child))
}

pub struct Launch {
    read: OwnedHandle, write: OwnedHandle, children: Vec<OwnedHandle>, session: String, key: String,
}
impl Launch {
    pub fn new(command: &mut CommandBuilder) -> Result<Self, String> {
        let (write, input) = pipe(false)?;
        let (read, output) = pipe(true)?;
        let session = format!("hub-{}", random_hex()?);
        let key = random_hex()?;
        command.args(["--session-id", &session, "--local-control-input", &format!("{}", input.as_raw_handle() as usize),
            "--local-control-output", &format!("{}", output.as_raw_handle() as usize)]);
        command.env("AGENT_RUNNER_LOCAL_CONTROL_KEY", &key);
        unsafe { command.set_windows_inherited_handles(vec![input.as_raw_handle() as usize, output.as_raw_handle() as usize]); }
        Ok(Self { read, write, children: vec![input, output], session, key })
    }
    pub fn bind(mut self, pid: u32) -> Arc<Client> {
        // Release redundant child endpoints immediately after CreateProcessW, before any hello wait.
        self.children.clear();
        let state = Arc::new(Mutex::new(Snapshot::default()));
        let stopped = Arc::new(AtomicBool::new(false));
        let (send, receive) = mpsc::sync_channel::<(Request, Admission)>(32);
        let worker_state = state.clone();
        let worker_stop = stopped.clone();
        let worker = thread::spawn(move || {
            let mut protocol = Protocol::new(pid, self.session);
            let result = serve(&self.read, &self.write, &mut protocol, &self.key, receive, &worker_stop, &worker_state);
            protocol.disconnect(result.err().unwrap_or("Runner control closed"));
            *worker_state.lock().unwrap() = protocol.public_snapshot();
            // The key is retained only by this native worker for authenticated requests.
            unsafe { self.key.as_bytes_mut().fill(0); }
        });
        Arc::new(Client { state, stopped, send, images: Images::default(), worker: Mutex::new(Some(worker)) })
    }
}

pub struct Client {
    state: Arc<Mutex<Snapshot>>, stopped: Arc<AtomicBool>, send: mpsc::SyncSender<(Request, Admission)>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
    images: Images,
}
impl Client {
    pub fn snapshot(&self) -> Snapshot { self.state.lock().unwrap().clone() }
    fn image_alive(&self) -> bool { !self.stopped.load(Ordering::Acquire) && self.snapshot().state == "ready" }
    fn image_reply(&self, request: generated_images::Request) -> Result<generated_images::Reply, generated_images::Failure> {
        let (send, receive) = mpsc::channel();
        self.submit(Request::Image(request, send)).map_err(|_| generated_images::Failure::unavailable())?;
        receive.recv_timeout(Duration::from_secs(65)).unwrap_or_else(|_| Err(generated_images::Failure::unavailable()))
    }
    pub fn images_list(&self) -> Result<Vec<generated_images::Metadata>, generated_images::Failure> {
        self.images.list(|request| self.image_reply(request), || self.image_alive())
    }
    pub fn image_read(&self, id: &str) -> Result<generated_images::Verified, generated_images::Failure> {
        self.images.read(id, |request| self.image_reply(request), || self.image_alive())
    }
    pub fn command(&self, command: String) -> Result<(), String> {
        if command.len() > 4096 || !command.starts_with('/') || command.chars().any(char::is_control) {
            return Err("Choose a Runner slash command".into());
        }
        self.submit(Request::Command(command)).map(|_| ()).map_err(|error| error.detail)
    }
    pub fn reference(&self, request: ReferenceRequest) -> ReferenceAdmission {
        if let Err(detail) = request.validate() { return ReferenceAdmission::Failure { detail: detail.into() }; }
        if self.snapshot().references.capability.is_none() {
            return ReferenceAdmission::Failure { detail: "This Runner offers only the manual /files flow".into() };
        }
        match self.submit(Request::Reference(request)) {
            Ok(id) => ReferenceAdmission::Admitted { id },
            Err(error) if error.unknown => ReferenceAdmission::Unknown { detail: error.detail },
            Err(error) => ReferenceAdmission::Failure { detail: error.detail },
        }
    }
    fn submit(&self, request: Request) -> Result<u64, SubmitError> {
        if self.stopped.load(Ordering::Acquire) || self.snapshot().state != "ready" {
            return Err("Runner control is disconnected or still connecting".into());
        }
        let (admitted, admission) = mpsc::channel();
        self.send.try_send((request, admitted)).map_err(|_| "Runner control request queue is unavailable")?;
        admission.recv().map_err(|_| SubmitError { unknown: true,
            detail: "Control admission outcome unknown; do not repeat registration".into() })?
            .map_err(|detail| SubmitError { detail, unknown: false })
    }
    pub fn close(&self) {
        self.stopped.store(true, Ordering::Release);
        self.images.clear();
        if let Some(worker) = self.worker.lock().unwrap().take() { let _ = worker.join(); }
    }
}
impl Drop for Client { fn drop(&mut self) { self.close(); } }

fn serve(read: &OwnedHandle, write: &OwnedHandle, protocol: &mut Protocol, key: &str,
    receive: mpsc::Receiver<(Request, Admission)>, stopped: &AtomicBool, state: &Mutex<Snapshot>) -> Result<(), &'static str> {
    let mut incoming = Vec::<u8>::new();
    let mut outgoing = Vec::<u8>::new();
    let started = Instant::now();
    let mut observed = Instant::now();
    while !stopped.load(Ordering::Acquire) {
        let mut available = 0;
        if unsafe { PeekNamedPipe(read.as_raw_handle(), std::ptr::null_mut(), 0,
            std::ptr::null_mut(), &mut available, std::ptr::null_mut()) } == 0 {
            return Err("Runner control pipe disconnected");
        }
        if available > 0 {
            let mut bytes = [0u8; 8192];
            let mut count = 0;
            if unsafe { ReadFile(read.as_raw_handle(), bytes.as_mut_ptr(), available.min(bytes.len() as u32),
                &mut count, std::ptr::null_mut()) } == 0 || count == 0 { return Err("Runner control read failed"); }
            incoming.extend_from_slice(&bytes[..count as usize]);
            while let Some(end) = incoming.iter().position(|b| *b == b'\n') {
                if end > 65536 { return Err("Runner control frame exceeded v1 limit"); }
                let packet = serde_json::from_slice(&incoming[..end]).map_err(|_| "Malformed Runner control response")?;
                incoming.drain(..=end);
                if protocol.connection.is_none() {
                    protocol.hello(&packet)?;
                    outgoing.extend(protocol.request(None, key)?);
                    observed = Instant::now();
                } else { protocol.response(packet)?; }
            }
            if incoming.len() > 65536 { return Err("Runner control frame exceeded v1 limit"); }
        }
        if protocol.snapshot.state == "ready" {
            for (request, admitted) in receive.try_iter() {
                let result = match request {
                    Request::Command(command) => protocol.request(Some(command), key),
                    Request::Reference(request) => protocol.reference_request(request, key),
                    Request::Image(request, completion) => protocol.image_request(request, completion, key),
                };
                let receipt = result.map(|bytes| {
                    outgoing.extend(bytes);
                    *state.lock().unwrap() = protocol.public_snapshot();
                    protocol.next
                }).map_err(str::to_owned);
                let _ = admitted.send(receipt);
            }
            if observed.elapsed() >= Duration::from_secs(1) && protocol.pending.is_empty() {
                outgoing.extend(protocol.request(None, key)?);
                observed = Instant::now();
            }
        }
        if !outgoing.is_empty() {
            let mut count = 0;
            let result = unsafe { WriteFile(write.as_raw_handle(), outgoing.as_ptr(), outgoing.len().min(4096) as u32,
                &mut count, std::ptr::null_mut()) };
            if result == 0 && unsafe { GetLastError() } != ERROR_NO_DATA { return Err("Runner control write failed"); }
            outgoing.drain(..count as usize);
        }
        *state.lock().unwrap() = protocol.public_snapshot();
        if protocol.expired() { return Err("Runner control completion timed out; uncertain commands were not retried"); }
        if protocol.connection.is_none() && started.elapsed() > Duration::from_secs(30) {
            return Err("Runner did not provide a v1 control hello");
        }
        thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}
