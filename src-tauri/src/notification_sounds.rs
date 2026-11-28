
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{ipc::Response, Manager, Runtime, Window};

const DIRECTORY: &str = "notification-sounds";
const DEFAULT_SOUNDS: &[(&str, &[u8])] = &[
    ("user-request.wav", include_bytes!("notification_sounds/user-request.wav")),
    ("work-completed.wav", include_bytes!("notification_sounds/work-completed.wav")),
    ("work-interrupted.wav", include_bytes!("notification_sounds/work-interrupted.wav")),
];
// Bound the memory and IPC cost of reading user-supplied audio in one response.
const MAX_SOUND_BYTES: u64 = 32 * 1024 * 1024;

pub fn initialize(app_data: &Path) -> io::Result<()> {
    let root = app_data.join(DIRECTORY);
    ensure_directory(&root)?;
    for (name, bytes) in DEFAULT_SOUNDS {
        match OpenOptions::new().write(true).create_new(true).open(root.join(name)) {
            Ok(mut file) => file.write_all(bytes)?,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn ensure_directory(root: &Path) -> io::Result<()> {
    fs::create_dir_all(root)?;
    if !fs::symlink_metadata(root)?.file_type().is_dir() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    Ok(())
}

fn supported(name: &str) -> bool {
    !name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '\0'..='\u{1f}' | '\u{7f}'))
        && Path::new(name).extension().and_then(|ext| ext.to_str()).is_some_and(|ext|
            ext.eq_ignore_ascii_case("wav") || ext.eq_ignore_ascii_case("mp3"))
}

fn list(root: &Path) -> io::Result<Vec<String>> {
    ensure_directory(root)?;
    let mut names = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            if let Ok(name) = entry.file_name().into_string() {
                if supported(&name) { names.push(name); }
            }
        }
    }
    Ok(names)
}

fn read(root: &Path, name: &str) -> io::Result<Vec<u8>> {
    if !supported(name) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    ensure_directory(root)?;
    let path = root.join(name);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.len() > MAX_SOUND_BYTES {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(MAX_SOUND_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SOUND_BYTES {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    Ok(bytes)
}

fn sound_directory<R: Runtime>(window: &Window<R>) -> Result<PathBuf, String> {
    if window.label() != "main" {
        return Err("Notification sounds are available only to the main window".into());
    }
    window.path().app_local_data_dir().map(|path| path.join(DIRECTORY)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_notification_sounds<R: Runtime>(window: Window<R>) -> Result<Vec<String>, String> {
    let root = sound_directory(&window)?;
    tauri::async_runtime::spawn_blocking(move || list(&root).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_notification_sound<R: Runtime>(window: Window<R>, name: String) -> Result<Response, String> {
    let root = sound_directory(&window)?;
    tauri::async_runtime::spawn_blocking(move || read(&root, &name).map(Response::new).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_notification_sound_folder<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let root = sound_directory(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_directory(&root).map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        let mut opener = Command::new("explorer.exe");
        #[cfg(target_os = "macos")]
        let mut opener = Command::new("/usr/bin/open");
        opener.arg(root).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
