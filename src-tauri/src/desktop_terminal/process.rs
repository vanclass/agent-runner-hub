use portable_pty::Child;

#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, BorrowedHandle, OwnedHandle};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{TerminateProcess, WaitForSingleObject};

#[cfg(windows)]
pub struct ProcessKiller(OwnedHandle, bool);
#[cfg(not(windows))]
pub struct ProcessKiller(Box<dyn portable_pty::ChildKiller + Send + Sync>, bool);

impl ProcessKiller {
    pub fn capture(child: &dyn Child) -> Result<Self, String> {
        #[cfg(windows)] {
            let raw = child.as_raw_handle().ok_or("ConPTY child has no process handle")?;
            // The child retains this handle while it is duplicated into independent ownership.
            let borrowed = unsafe { BorrowedHandle::borrow_raw(raw) };
            return borrowed.try_clone_to_owned().map(|handle| Self(handle, false)).map_err(|e| e.to_string());
        }
        #[cfg(not(windows))] { Ok(Self(child.clone_killer(), false)) }
    }
    pub fn kill(&mut self) -> Result<(), String> {
        if self.1 { return Ok(()); }
        #[cfg(windows)] let result = terminate(self.0.as_raw_handle());
        #[cfg(not(windows))] let result = self.0.kill().map_err(|e| e.to_string());
        if result.is_ok() { self.1 = true; }
        result
    }
}

#[cfg(windows)]
fn terminate(handle: std::os::windows::io::RawHandle) -> Result<(), String> {
    // portable-pty 0.9 inverts this API's result. Keep exact owned-handle termination local.
    if unsafe { TerminateProcess(handle, 1) } != 0 { return Ok(()); }
    let error = std::io::Error::last_os_error();
    if unsafe { WaitForSingleObject(handle, 0) } == 0 { return Ok(()); }
    Err(error.to_string())
}

pub fn terminate_child(child: &mut dyn Child) -> Result<(), String> {
    #[cfg(windows)] { terminate(child.as_raw_handle().ok_or("ConPTY child has no process handle")?) }
    #[cfg(not(windows))] { child.kill().map_err(|e| e.to_string()) }
}
