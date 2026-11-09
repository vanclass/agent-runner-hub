#[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
mod desktop_terminal;

#[cfg(all(feature = "native-webdriver", not(debug_assertions)))]
compile_error!("native-webdriver is restricted to dedicated debug test builds");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(all(feature = "native-webdriver", debug_assertions, any(target_os = "windows", target_os = "macos")))]
    let probe_port = {
        let port: u16 = std::env::var("TAURI_WEBDRIVER_PORT")
            .expect("native-webdriver requires an explicit isolated probe port")
            .parse().expect("invalid native probe port");
        assert_ne!(port, 0, "native probe port must be nonzero");
        let config = context.config();
        assert!(config.app.app_directories_override.is_some(), "native probe requires isolated app data");
        assert!(config.app.windows.iter().all(|w| !w.visible && !w.focus && !w.focusable),
            "native probe windows must start hidden, unfocused and unfocusable");
        port
    };
    // runner-desktop-integration-v1: optional integrations share this existing builder.
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "native-webdriver", debug_assertions, any(target_os = "windows", target_os = "macos")))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init_with_port(probe_port));
    #[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
    let builder = desktop_terminal::configure(builder);
    #[cfg(all(feature = "native-io", any(target_os = "windows", target_os = "macos")))]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());
    builder
        .run(context)
        .expect("Web App native runtime failed");
}
