fn main() {
    let attributes = tauri_build::Attributes::new();
    tauri_build::try_build(attributes).expect("Tauri build failed");
}
