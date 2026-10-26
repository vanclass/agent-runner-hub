mod pty;
use pty::{control, runner, OpenRequest, PtyEvent, Sessions};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager, Runtime, State, Window};

pub fn configure<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(windows)]
    let builder = builder.invoke_handler(tauri::generate_handler![runner_resolve, runner_observe, runner_command,
        runner_reference, runner_images_list, runner_image_read, runner_stage_clipboard, pty_open, pty_write,
        pty_resize, pty_ack, pty_close]);
    #[cfg(not(windows))]
    let builder = builder.invoke_handler(tauri::generate_handler![runner_resolve, runner_observe, runner_command,
        runner_reference, runner_stage_clipboard, pty_open, pty_write, pty_resize, pty_ack, pty_close]);
    builder.manage(Arc::new(Sessions::default()))
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<Arc<Sessions>>().close_window(window.label());
            }
        })
}

#[tauri::command]
fn runner_observe<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String) -> Result<control::Snapshot, String> {
    state.owned(&id, window.label())?.control_snapshot()
}

#[tauri::command]
async fn runner_command<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String, command: String) -> Result<(), String> {
    let session = state.owned(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || session.control_command(command)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn runner_reference<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String,
    request: control::references::ReferenceRequest) -> Result<control::references::ReferenceAdmission, String> {
    let session = state.owned(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || session.control_reference(request)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn runner_stage_clipboard<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String,
    png: Vec<u8>) -> Result<String, String> {
    let session = state.owned(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || session.stage_clipboard(&png)).await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
#[tauri::command]
async fn runner_images_list<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String)
    -> Result<Vec<control::generated_images::Metadata>, control::generated_images::Failure> {
    let session = state.owned(&id, window.label()).map_err(|_| control::generated_images::Failure::unavailable())?;
    tauri::async_runtime::spawn_blocking(move || session.images_list()).await
        .map_err(|_| control::generated_images::Failure::failed("Image discovery failed"))?
}

#[cfg(windows)]
#[tauri::command]
async fn runner_image_read<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String, image_id: String)
    -> Result<control::generated_images::Verified, control::generated_images::Failure> {
    let session = state.owned(&id, window.label()).map_err(|_| control::generated_images::Failure::unavailable())?;
    tauri::async_runtime::spawn_blocking(move || session.image_read(&image_id)).await
        .map_err(|_| control::generated_images::Failure::failed("Image retrieval failed"))?
}

#[tauri::command]
async fn runner_resolve<R: Runtime>(window: Window<R>, location: String) -> Result<runner::Installation, String> {
    if window.label() != "main" { return Err("Runner configuration is available only to the main window".into()); }
    tauri::async_runtime::spawn_blocking(move || runner::resolve(&location)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pty_open<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, request: OpenRequest,
    on_event: Channel<PtyEvent>) -> Result<String, String> {
    if window.label() != "main" { return Err("Desktop Terminal is available only to the main window".into()); }
    // PTY creation can block; keep it off the WebView/main event loop.
    let sessions = state.inner().clone();
    // Register ownership before dispatch so window destruction also cancels pending creation.
    let (id, session) = sessions.reserve(window.label().into())?;
    tauri::async_runtime::spawn_blocking(move || sessions.start(id, session, request,
        Arc::new(move |event| on_event.send(event).map_err(|e| e.to_string()))))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pty_write<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String, bytes: Vec<u8>) -> Result<(), String> {
    let session = state.owned(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || session.write(&bytes)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pty_resize<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let session = state.owned(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || session.resize(cols, rows)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn pty_ack<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String, sequence: u64) -> Result<(), String> {
    state.owned(&id, window.label())?.acknowledge(sequence)
}

#[tauri::command]
async fn pty_close<R: Runtime>(window: Window<R>, state: State<'_, Arc<Sessions>>, id: String) -> Result<(), String> {
    let session = state.owned(&id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || session.close()).await.map_err(|e| e.to_string())?
}
