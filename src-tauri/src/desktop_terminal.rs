mod pty;
use pty::{OpenRequest, PtyEvent, Sessions};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager, Runtime, State, Window};

pub fn configure<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(Arc::new(Sessions::default()))
        .invoke_handler(tauri::generate_handler![pty_open, pty_write, pty_resize, pty_ack, pty_close])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<Arc<Sessions>>().close_window(window.label());
            }
        })
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
