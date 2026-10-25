use super::*;

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

#[test]
fn validates_pixels_before_creating_any_file() {
    let mut files = ClipboardFiles::default();
    for bytes in [Vec::new(), b"not png".to_vec(), b"\x89PNG\r\n\x1a\n".to_vec(), png()[..40].to_vec()] {
        assert!(files.stage(&bytes).is_err());
        assert!(files.directory.is_none());
        assert!(files.files.is_empty());
    }
    let mut corrupt = png(); corrupt[44] ^= 1;
    assert!(files.stage(&corrupt).is_err());
    assert!(files.directory.is_none());
}

#[test]
fn independently_readable_unique_sources_remain_until_explicit_release() {
    let bytes = png();
    let mut first = ClipboardFiles::default(); let mut second = ClipboardFiles::default();
    let a = PathBuf::from(first.stage(&bytes).unwrap());
    let b = PathBuf::from(first.stage(&bytes).unwrap());
    let c = PathBuf::from(second.stage(&bytes).unwrap());
    assert_ne!(a, b); assert_ne!(a.parent(), c.parent());
    assert_eq!(fs::read(&a).unwrap(), bytes);
    assert_eq!(fs::read(&b).unwrap(), bytes);
    assert_eq!(identity(&first.files[0]).unwrap(), identity(&File::open(&a).unwrap()).unwrap());
    assert!(OpenOptions::new().write(true).open(&a).is_err(), "live bytes reject new writers");
    first.release_after_termination().unwrap();
    assert!(first.stage(&bytes).is_err(), "an ended owner cannot create late sources");
    assert!(!a.exists() && !b.exists() && !a.parent().unwrap().exists());
    assert_eq!(fs::read(&c).unwrap(), bytes, "other session must survive");
    second.release_after_termination().unwrap();
    assert!(!c.parent().unwrap().exists());
}

#[test]
fn cleanup_uses_original_identity_even_after_rename_and_replacement() {
    let mut files = ClipboardFiles::default();
    let path = PathBuf::from(files.stage(&png()).unwrap());
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
    let path = PathBuf::from(files.stage(&png()).unwrap());
    drop(files);
    assert_eq!(fs::read(&path).unwrap(), png(), "Drop must not delete a potentially live source");
    fs::remove_file(&path).unwrap(); fs::remove_dir(path.parent().unwrap()).unwrap();
}
