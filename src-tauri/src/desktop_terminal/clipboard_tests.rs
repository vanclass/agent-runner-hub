use super::*;

fn root() -> PathBuf {
    let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().take(8)
        .find(|path| path.join(".git").exists()).expect("checkout-local native fixture");
    checkout.join("temp").join(format!("clipboard-tests-{}", std::process::id()))
}

fn png() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
    }
    bytes
}

fn assert_staged_name(path: &Path) {
    let session = path.parent().unwrap().file_name().unwrap().to_str().unwrap();
    let image = path.file_name().unwrap().to_str().unwrap();
    let session_id = session.strip_prefix("session-").unwrap();
    let image_id = image.strip_prefix("image-").unwrap().strip_suffix(".png").unwrap();
    for id in [session_id, image_id] {
        assert_eq!(id.len(), 32);
        assert!(id.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    }
    assert_ne!(session_id, image_id);
}

#[test]
fn development_and_installed_roots_do_not_depend_on_working_directory() {
    let fixture = root();
    let checkout = fixture.parent().unwrap().parent().unwrap();
    let expected = checkout.canonicalize().unwrap().join("local/runtime/clipboard");
    for manifest in [checkout.join("src-tauri"), checkout.join(".project-config/managed/web-app-tauri/cache/dev/attempt/src-tauri")] {
        assert_eq!(select_root(true, &manifest, None, Err("unused".into())).unwrap(), expected);
    }
    let profile = checkout.join(".project-config/managed/web-app-tauri/cache/webview2");
    let missing = fixture.join("no-checkout/src-tauri");
    assert_eq!(select_root(false, &missing, Some((&profile, &profile)), Err("unused".into())).unwrap(), expected);
    let data = fixture.join("private-app-data");
    assert_eq!(select_root(false, &missing, None, Ok(data.clone())).unwrap(), data.join("clipboard"));
    assert_eq!(select_root(false, &missing, Some((&profile, &missing)), Ok(data.clone())).unwrap(), data.join("clipboard"));
    assert!(select_root(false, &missing, None, Err("provider failure".into())).unwrap_err().contains("provider failure"));
    assert!(select_root(true, &missing, None, Ok(data)).is_err());
    assert!(select_root(false, &missing, None, Ok("relative".into())).is_err());
}

#[test]
fn validates_pixels_before_creating_any_file() {
    let mut files = ClipboardFiles::default();
    for bytes in [Vec::new(), b"not png".to_vec(), b"\x89PNG\r\n\x1a\n".to_vec(), png()[..40].to_vec()] {
        assert!(files.stage(&bytes, &root()).is_err());
        assert!(files.directory.is_none());
        assert!(files.files.is_empty());
    }
    let mut corrupt = png(); corrupt[44] ^= 1;
    assert!(files.stage(&corrupt, &root()).is_err());
    assert!(files.directory.is_none());
}

#[test]
fn selected_roots_contain_created_pngs_and_survive_session_cleanup() {
    let fixture = root();
    let checkout = fixture.parent().unwrap().parent().unwrap();
    let development = select_root(true, &checkout.join("src-tauri"), None, Err("unused".into())).unwrap();
    let installed = select_root(false, Path::new("absent-checkout"), None, Ok(fixture.join("app-data"))).unwrap();
    for root in [development, installed] {
        let mut files = ClipboardFiles::default();
        let path = PathBuf::from(files.stage(&png(), &root).unwrap());
        assert_staged_name(&path);
        assert!(path.canonicalize().unwrap().starts_with(root.canonicalize().unwrap()));
        assert_eq!(path.parent().unwrap().parent().unwrap().canonicalize().unwrap(), root.canonicalize().unwrap());
        assert_eq!(fs::read(&path).unwrap(), png());
        println!("Selected PNG root: {}", root.display());
        files.release_after_termination().unwrap();
        assert!(!path.exists()); assert!(root.is_dir());
    }
}

#[test]
fn independently_readable_unique_sources_remain_until_explicit_release() {
    let bytes = png();
    let mut first = ClipboardFiles::default(); let mut second = ClipboardFiles::default();
    let a = PathBuf::from(first.stage(&bytes, &root()).unwrap());
    let b = PathBuf::from(first.stage(&bytes, &root()).unwrap());
    let c = PathBuf::from(second.stage(&bytes, &root()).unwrap());
    for path in [&a, &b, &c] { assert_staged_name(path); }
    assert_eq!(a.parent(), b.parent());
    assert_ne!(a.file_name(), b.file_name());
    assert_ne!(a, b); assert_ne!(a.parent(), c.parent());
    assert_eq!(fs::read(&a).unwrap(), bytes);
    assert_eq!(fs::read(&b).unwrap(), bytes);
    assert_eq!(identity(&first.files[0]).unwrap(), identity(&File::open(&a).unwrap()).unwrap());
    assert!(OpenOptions::new().write(true).open(&a).is_err(), "live bytes reject new writers");
    first.release_after_termination().unwrap();
    assert!(first.stage(&bytes, &root()).is_err(), "an ended owner cannot create late sources");
    assert!(!a.exists() && !b.exists() && !a.parent().unwrap().exists());
    assert_eq!(fs::read(&c).unwrap(), bytes, "other session must survive");
    second.release_after_termination().unwrap();
    assert!(!c.parent().unwrap().exists());
}

#[test]
fn cleanup_uses_original_identity_even_after_rename_and_replacement() {
    let mut files = ClipboardFiles::default();
    let path = PathBuf::from(files.stage(&png(), &root()).unwrap());
    let renamed = path.with_file_name("moved-owned.png");
    fs::rename(&path, &renamed).unwrap();
    fs::write(&path, b"unrelated replacement").unwrap();
    let foreign = path.with_file_name("unrelated.txt"); fs::write(&foreign, b"keep").unwrap();
    assert!(files.release_after_termination().is_err(), "nonempty directory is retained");
    assert!(!renamed.exists(), "delete exact original object");
    assert_eq!(fs::read(&path).unwrap(), b"unrelated replacement");
    assert_eq!(fs::read(&foreign).unwrap(), b"keep");
    fs::remove_file(&path).unwrap(); fs::remove_file(&foreign).unwrap();
    fs::remove_dir(path.parent().unwrap()).unwrap();
}

#[test]
fn guard_loss_does_not_assume_termination() {
    let mut files = ClipboardFiles::default();
    let path = PathBuf::from(files.stage(&png(), &root()).unwrap());
    drop(files);
    assert_eq!(fs::read(&path).unwrap(), png(), "Drop must not delete a potentially live source");
    fs::remove_file(&path).unwrap(); fs::remove_dir(path.parent().unwrap()).unwrap();
}

#[test]
fn storage_failure_has_no_temporary_fallback() {
    let parent = root(); fs::create_dir_all(&parent).unwrap();
    let blocked = parent.join(format!("blocked-{}", random_name().unwrap()));
    fs::write(&blocked, b"unrelated").unwrap();
    let mut files = ClipboardFiles::default();
    assert!(files.stage(&png(), &blocked).unwrap_err().contains("initialization failed"));
    assert!(files.directory.is_none() && files.files.is_empty());
    assert_eq!(fs::read(&blocked).unwrap(), b"unrelated");
    fs::remove_file(blocked).unwrap();
}

#[test]
fn cleanup_failure_retains_exact_handle_until_a_verified_retry() {
    let mut files = ClipboardFiles::default();
    let path = PathBuf::from(files.stage(&png(), &root()).unwrap());
    let reader = OpenOptions::new().read(true).share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE).open(&path).unwrap();
    assert!(files.release_after_termination().is_err());
    assert_eq!(files.files.len(), 1); assert_eq!(fs::read(&path).unwrap(), png());
    drop(reader);
    files.release_after_termination().unwrap();
    assert!(!path.exists());
}

#[test]
fn session_limits_reject_new_sources_without_releasing_owned_bytes() {
    let mut files = ClipboardFiles::default();
    let bytes = png();
    let source = PathBuf::from(files.stage(&bytes, &root()).unwrap());
    files.bytes = MAX_SESSION_BYTES;
    assert!(files.stage(&bytes, &root()).unwrap_err().contains("staging limit"));
    assert_eq!(fs::read(&source).unwrap(), bytes);
    files.release_after_termination().unwrap();
    assert!(!source.exists());
    let mut files = ClipboardFiles::default();
    for _ in 0..MAX_SESSION_IMAGES { files.stage(&bytes, &root()).unwrap(); }
    assert!(files.stage(&bytes, &root()).unwrap_err().contains("staging limit"));
    files.release_after_termination().unwrap();
}
