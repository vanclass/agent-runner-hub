#[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
mod desktop_terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // runner-desktop-integration-v1: optional integrations share this existing builder.
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
    let builder = desktop_terminal::configure(builder);
    #[cfg(all(feature = "native-io", any(target_os = "windows", target_os = "macos")))]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());
    builder
        .run(tauri::generate_context!())
        .expect("Web App native runtime failed");
}
