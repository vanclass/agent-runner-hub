#[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
mod desktop_terminal;
#[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
mod hub_log;
#[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
mod image_validation;
#[cfg(all(feature = "desktop-terminal", any(target_os = "windows", target_os = "macos")))]
mod local_preview;

#[cfg(all(feature = "native-webdriver", not(debug_assertions)))]
compile_error!("native-webdriver is restricted to dedicated debug test builds");

#[cfg(all(feature = "native-webdriver", debug_assertions, target_os = "macos"))]
mod native_automation_macos;

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
        let focus_required = cfg!(target_os = "windows")
            && std::env::var("HUB_NATIVE_PRESENTATION").as_deref() == Ok("focus-required");
        assert!(config.app.windows.iter().all(|w| !w.visible && !w.focus
            && (if focus_required { w.label == "main" && w.focusable } else { !w.focusable })),
            "native probe windows must start hidden/unfocused; focusable requires explicit Windows test mode");
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
    #[cfg(all(feature = "native-webdriver", debug_assertions, target_os = "macos"))]
    {
        builder.activate_ignoring_other_apps(false)
            .build(context).expect("Native test application build failed")
            .run(|app, event| {
                if matches!(event, tauri::RunEvent::Ready) { native_automation_macos::ready(app); }
            });
    }
    #[cfg(not(all(feature = "native-webdriver", debug_assertions, target_os = "macos")))]
    builder
        .run(context)
        .expect("Web App native runtime failed");
}
