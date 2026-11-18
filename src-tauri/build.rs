fn main() {
    let attributes = tauri_build::Attributes::new();
    #[cfg(all(feature = "native-webdriver", target_os = "windows"))]
    let attributes = attributes.plugin("ole-probe",
        tauri_build::InlinedPlugin::new().commands(&["start", "observations"]));
    tauri_build::try_build(attributes).expect("Tauri build failed");
}
