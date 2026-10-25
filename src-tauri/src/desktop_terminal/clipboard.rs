//! Hub-owned source staging only; Runner remains the reference authority.
use std::{fs::{self, File, OpenOptions}, io::{Cursor, Write}, path::PathBuf,
    os::windows::{fs::OpenOptionsExt, io::{AsRawHandle, FromRawHandle}}};
use windows_sys::Win32::{Foundation::INVALID_HANDLE_VALUE,
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG}, Storage::FileSystem::*};

const MAX_PNG_BYTES: usize = 64 * 1024 * 1024;
const MAX_PIXELS: u64 = 32 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 128 * 1024 * 1024;
// Keep the user action unavailable until positive clipboard acquisition has
// been exercised in the actual Windows Hub. Native staging is verified separately.
pub const CLIPBOARD_PNG_VERIFIED: bool = false;

fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_PNG_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Clipboard data is not a supported PNG (maximum 64 MiB)".into());
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: MAX_DECODED_BYTES });
    let mut reader = decoder.read_info().map_err(|_| "Clipboard PNG header is invalid")?;
    let info = reader.info();
    if info.width == 0 || info.height == 0 || u64::from(info.width) * u64::from(info.height) > MAX_PIXELS
        || info.animation_control.is_some() {
        return Err("Clipboard PNG dimensions or animation are unsupported".into());
    }
    let size = reader.output_buffer_size().filter(|size| *size <= MAX_DECODED_BYTES)
        .ok_or("Clipboard PNG decoded size is unsupported")?;
    reader.next_frame(&mut vec![0; size]).map_err(|_| "Clipboard PNG pixels are invalid")?;
    reader.finish().map_err(|_| "Clipboard PNG is incomplete")?;
    Ok(())
}

fn random_name() -> Result<String, String> {
    let mut bytes = [0; 16];
    if unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32,
        BCRYPT_USE_SYSTEM_PREFERRED_RNG) } != 0 { return Err("Clipboard file identity could not be created".into()); }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn resolved(file: &File) -> Result<PathBuf, String> {
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle(), buffer.as_mut_ptr(), buffer.len() as u32, 0) };
    if length == 0 || length as usize >= buffer.len() { return Err("Clipboard file location could not be verified".into()); }
    let attributes = information::<FILE_ATTRIBUTE_TAG_INFO>(file, FileAttributeTagInfo)?;
    if attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Clipboard staging does not accept filesystem indirection".into());
    }
    Ok(PathBuf::from(String::from_utf16(&buffer[..length as usize]).map_err(|_| "Clipboard file path is invalid")?))
}

fn information<T>(file: &File, class: FILE_INFO_BY_HANDLE_CLASS) -> Result<T, String> {
    let mut value = std::mem::MaybeUninit::<T>::zeroed();
    if unsafe { GetFileInformationByHandleEx(file.as_raw_handle(), class, value.as_mut_ptr().cast(),
        std::mem::size_of::<T>() as u32) } == 0 { return Err("Clipboard file ownership could not be verified".into()); }
    Ok(unsafe { value.assume_init() })
}

fn identity(file: &File) -> Result<(u64, [u8; 16]), String> {
    let info = information::<FILE_ID_INFO>(file, FileIdInfo)?;
    Ok((info.VolumeSerialNumber, info.FileId.Identifier))
}

fn delete_owned(file: &File) -> Result<(), String> {
    // Obtain DELETE access only after consumers have ended. Normal Python readers
    // need not share DELETE access while the source is live.
    let handle = unsafe { ReOpenFile(file.as_raw_handle(), DELETE | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, 0) };
    if handle == INVALID_HANDLE_VALUE { return Err("Clipboard cleanup could not reopen its owned file".into()); }
    let deletion = unsafe { File::from_raw_handle(handle) };
    if identity(file)? != identity(&deletion)? { return Err("Clipboard cleanup identity mismatch".into()); }
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    if unsafe { SetFileInformationByHandle(deletion.as_raw_handle(), FileDispositionInfo,
        &disposition as *const _ as *const _, std::mem::size_of_val(&disposition) as u32) } == 0 {
        return Err("Clipboard cleanup failed; source retained".into());
    }
    Ok(())
}

struct Directory { path: PathBuf, _guard: File }
impl Directory {
    fn new() -> Result<Self, String> {
        let parent = std::env::temp_dir().canonicalize().map_err(|_| "Windows temporary directory is unavailable")?;
        let path = parent.join(format!("AgentRunnerHub-clipboard-{}", random_name()?));
        fs::create_dir(&path).map_err(|_| "Windows temporary directory is not writable")?;
        let guard = OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(&path)
            .map_err(|_| "Clipboard directory ownership could not be acquired")?;
        let actual = resolved(&guard)?;
        if actual.parent() != Some(parent.as_path()) { return Err("Clipboard directory escaped its temporary parent".into()); }
        identity(&guard)?;
        Ok(Self { path: actual, _guard: guard })
    }
}

#[derive(Default)]
pub struct ClipboardFiles { directory: Option<Directory>, files: Vec<File>, terminated: bool }
impl ClipboardFiles {
    pub fn stage(&mut self, bytes: &[u8]) -> Result<String, String> {
        if self.terminated { return Err("Clipboard source owner has terminated".into()); }
        validate_png(bytes)?;
        if self.directory.is_none() { self.directory = Some(Directory::new()?); }
        let directory = self.directory.as_ref().unwrap();
        let path = directory.path.join(format!("clipboard-{}.png", random_name()?));
        let mut file = OpenOptions::new().create_new(true).read(true).write(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&path).map_err(|_| "Clipboard temporary file could not be created")?;
        let written = (|| {
            if resolved(&file)?.parent() != Some(directory.path.as_path()) { return Err("Clipboard file escaped its owning directory".into()); }
            identity(&file)?;
            file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "Clipboard temporary file could not be written")?;
            // Verify a second ordinary reader while the ownership handle is retained.
            if fs::read(&path).map_err(|_| "Clipboard source is not independently readable")? != bytes {
                return Err("Clipboard source verification failed".into());
            }
            Ok(())
        })();
        if let Err(error) = written {
            // Never submitted: deleting this exact creation handle is safe.
            if delete_owned(&file).is_err() { self.files.push(file); }
            return Err(error);
        }
        self.files.push(file);
        let text = path.to_str().ok_or("Clipboard source path is invalid")?;
        Ok(if let Some(unc) = text.strip_prefix("\\\\?\\UNC\\") { format!("\\\\{unc}") }
            else { text.strip_prefix("\\\\?\\").unwrap_or(text).into() })
    }

    // Called only after the owning Windows Job has been verified empty. No receipt,
    // inventory sample, UI clear, disconnect or Drop can release possibly live bytes.
    pub fn release_after_termination(&mut self) -> Result<(), String> {
        self.terminated = true;
        let mut retained = Vec::new();
        for file in self.files.drain(..) {
            if delete_owned(&file).is_err() { retained.push(file); }
        }
        self.files = retained;
        if !self.files.is_empty() { return Err("Clipboard cleanup incomplete; owned sources retained".into()); }
        if let Some(directory) = self.directory.take() {
            let path = directory.path.clone();
            drop(directory);
            // Empty-directory removal only: unrelated contents are never traversed.
            if let Err(error) = fs::remove_dir(path) {
                if error.kind() != std::io::ErrorKind::NotFound { return Err("Clipboard directory retained (not empty or unavailable)".into()); }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "clipboard_tests.rs"]
mod tests;
