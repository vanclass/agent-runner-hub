use portable_pty::CommandBuilder;
use std::{os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle}, time::{Duration, Instant}};
use windows_sys::Win32::System::JobObjects::*;

pub struct Job(OwnedHandle);

impl Job {
    pub fn new() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle) });
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let result = unsafe { SetInformationJobObject(handle, JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) };
        if result == 0 { return Err(std::io::Error::last_os_error().to_string()); }
        Ok(job)
    }

    pub fn configure(&self, command: &mut CommandBuilder) {
        // Session retains this non-inheritable handle through spawn and all child execution.
        unsafe { command.set_windows_job(self.0.as_raw_handle() as usize); }
    }

    pub fn terminate(&self) -> Result<(), String> {
        let handle = self.0.as_raw_handle();
        if unsafe { TerminateJobObject(handle, 1) } == 0 {
            return Err(format!("Runner job termination failed: {}", std::io::Error::last_os_error()));
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let mut state: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
            let result = unsafe { QueryInformationJobObject(handle, JobObjectBasicAccountingInformation,
                &mut state as *mut _ as *mut _, std::mem::size_of_val(&state) as u32, std::ptr::null_mut()) };
            if result == 0 { return Err(std::io::Error::last_os_error().to_string()); }
            if state.ActiveProcesses == 0 { return Ok(()); }
            if Instant::now() >= deadline { return Err("Timed out waiting for the owned Runner job to empty".into()); }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
